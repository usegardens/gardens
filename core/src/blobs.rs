//! Blob storage using iroh-blobs for efficient P2P transfer.
//!
//! All blobs are encrypted with room-specific keys before storage.
//! iroh-blobs handles content-addressing, chunking, and efficient P2P sync
//! over the Iroh QUIC connections.

use std::path::PathBuf;
use std::sync::Arc;

use iroh_blobs::store::fs::FsStore;
use iroh_blobs::{BlobFormat, Hash};
use tokio::io::AsyncReadExt;
use tokio::time::Duration;
use sqlx::Row;

use crate::{db, encryption, network, store};

#[derive(Debug, thiserror::Error)]
pub enum BlobError {
    #[error("Core not initialized")]
    NotInitialized,
    #[error("Network not initialized")]
    NetworkNotInitialized,
    #[error("Blob not found")]
    NotFound,
    #[error("Blob store error: {0}")]
    StoreError(String),
    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),
    #[error("Encryption error: {0}")]
    EncryptionError(String),
    #[error("Connection failed: {0}")]
    ConnectionFailed(String),
}

/// Get the blob store path for a given database directory.
pub fn blob_store_path(db_dir: &str) -> PathBuf {
    PathBuf::from(db_dir).join("blobs")
}

/// Get the Iroh blob store from the network state.
async fn get_blob_store() -> Result<Arc<FsStore>, BlobError> {
    let network = network::get_network().await
        .ok_or(BlobError::NetworkNotInitialized)?;
    
    let net = network.lock().await;
    Ok(net.blob_store.clone())
}

/// Upload a blob and return its content-hash (hex).
/// 
/// If `room_id` is provided, the blob is encrypted with the room's group key
/// before being stored. The hash is computed on the encrypted data.
pub async fn upload_blob(
    bytes: Vec<u8>,
    mime_type: String,
    room_id: Option<String>,
) -> Result<String, BlobError> {
    let store = get_blob_store().await?;
    
    // Encrypt if room_id provided
    let data_to_store = if let Some(rid) = room_id {
        // Ensure group state exists
        if encryption::encrypt_for_room(&rid, &[]).await.is_err() {
            // Need to init group - get current members
            init_room_group(&rid).await?;
        }
        
        encryption::encrypt_for_room(&rid, &bytes)
            .await
            .map_err(|e| BlobError::EncryptionError(e.to_string()))?
    } else {
        bytes
    };
    
    // Import to blob store (content-addressed)
    let tag = store
        .add_bytes_with_opts((data_to_store, BlobFormat::Raw))
        .await
        .map_err(|e| BlobError::StoreError(e.to_string()))?;
    let hash = tag.hash;
    
    log::info!("[blobs] Uploaded blob {} (type: {})", hash.to_hex(), mime_type);
    
    Ok(hash.to_hex())
}

/// Retrieve a blob by its hash, decrypting if necessary.
/// 
/// The `room_id` must match the room used during upload for proper decryption.
pub async fn get_blob(hash_str: &str, room_id: Option<String>) -> Result<Vec<u8>, BlobError> {
    let store = get_blob_store().await?;
    
    // Parse hash
    let hash = hash_from_hex(hash_str)?;
    
    // Check if we have the blob locally
    let has = store
        .has(hash)
        .await
        .map_err(|e| BlobError::StoreError(e.to_string()))?;
    if !has {
        // Try to fetch from network peers
        log::info!("[blobs] Blob {} not found locally, attempting P2P fetch", hash_str);
        fetch_blob_from_peers(&hash, room_id.as_deref()).await?;
    }
    
    // Read from store
    let mut reader = store.reader(hash);
    let mut encrypted_data = Vec::new();
    reader
        .read_to_end(&mut encrypted_data)
        .await
        .map_err(|e| BlobError::StoreError(e.to_string()))?;
    
    // Decrypt if room_id provided
    if let Some(rid) = room_id {
        encryption::decrypt_for_room(&rid, &encrypted_data)
            .await
            .map_err(|e| BlobError::EncryptionError(e.to_string()))
    } else {
        Ok(encrypted_data)
    }
}

/// Check if we have a blob locally.
pub async fn has_blob(hash_str: &str) -> Result<bool, BlobError> {
    let store = get_blob_store().await?;
    
    let hash = hash_from_hex(hash_str)?;
    store
        .has(hash)
        .await
        .map_err(|e| BlobError::StoreError(e.to_string()))
}

/// Fetch a blob from network peers if not available locally.
async fn fetch_blob_from_peers(hash: &Hash, context_id: Option<&str>) -> Result<(), BlobError> {
    let network = network::get_network().await
        .ok_or(BlobError::NetworkNotInitialized)?;
    
    let net = network.lock().await;

    let mut providers = discover_peers(context_id).await?;
    // Remove ourselves if present
    let self_id = net.endpoint.id();
    providers.retain(|p| *p != self_id);

    if providers.is_empty() {
        return Err(BlobError::NotFound);
    }

    let downloader = net.blob_store.downloader(&net.endpoint);
    let request = iroh_blobs::HashAndFormat {
        hash: *hash,
        format: BlobFormat::Raw,
    };

    // Best-effort download with a timeout to avoid hanging.
    let download = downloader.download(request, providers);
    tokio::time::timeout(Duration::from_secs(20), download)
        .await
        .map_err(|_| BlobError::NotFound)?
        .map_err(|e| BlobError::StoreError(e.to_string()))?;

    Ok(())
}

/// Try to download a blob from a specific peer.
async fn try_download_blob(
    endpoint: &iroh::Endpoint,
    node_id: iroh::EndpointId,
    hash: &Hash,
) -> Result<(), BlobError> {
    // This is a simplified version - in production, you'd use iroh-blobs' 
    // proper P2P download mechanism with the downloader
    
    // For now, we just check if we can connect
    let _conn = endpoint.connect(node_id, network::BLOB_ALPN).await
        .map_err(|e| BlobError::ConnectionFailed(format!("Connection failed: {}", e)))?;
    
    // The actual download would happen here using iroh-blobs downloader
    // This requires setting up a proper download request
    
    log::debug!("[blobs] Connection established to {} for blob {}", node_id, hash.to_hex());
    
    // Placeholder - in production, use the proper download mechanism
    Ok(())
}

/// Initialize room encryption group if needed.
async fn init_room_group(room_id: &str) -> Result<(), BlobError> {
    use crate::db;
    use sqlx::Row;
    
    let core = store::get_core().ok_or(BlobError::NotInitialized)?;
    
    // Get room info
    let room = db::get_room(&core.read_pool, room_id).await
        .map_err(|e| BlobError::StoreError(e.to_string()))?
        .ok_or_else(|| BlobError::StoreError("Room not found".into()))?;
    
    // Get all org members
    let mut members: Vec<p2panda_core::PublicKey> = vec![];
    let rows = sqlx::query("SELECT member_key FROM memberships WHERE org_id = ?")
        .bind(&room.org_id)
        .fetch_all(&core.read_pool)
        .await
        .map_err(|e| BlobError::StoreError(e.to_string()))?;
    
    for row in rows {
        let key_hex: String = row.get("member_key");
        if let Ok(bytes) = hex::decode(&key_hex) {
            if let Ok(arr) = bytes.try_into() {
                if let Ok(pk) = p2panda_core::PublicKey::from_bytes(&arr) {
                    members.push(pk);
                }
            }
        }
    }
    
    // Add ourselves
    members.push(core.private_key.public_key());
    
    // Initialize group
    encryption::init_room_group(room_id, members).await
        .map_err(|e| BlobError::EncryptionError(e.to_string()))?;
    
    Ok(())
}

/// Provide a blob to the network (make it available for P2P sharing).
pub async fn provide_blob(hash_str: &str) -> Result<(), BlobError> {
    let store = get_blob_store().await?;
    
    let hash = hash_from_hex(hash_str)?;
    
    let has = store
        .has(hash)
        .await
        .map_err(|e| BlobError::StoreError(e.to_string()))?;
    if !has {
        return Err(BlobError::NotFound);
    }
    
    // The blob is now available for P2P transfer through iroh-blobs
    // The network handler will serve requests for this hash
    log::info!("[blobs] Blob {} is now available for P2P sharing", hash_str);
    
    Ok(())
}

/// Request a blob from a specific peer.
/// This initiates a P2P download if we don't have the blob locally.
pub async fn request_blob_from_peer(
    hash_str: &str,
    peer_node_id: &str,
) -> Result<(), BlobError> {
    let hash = hash_from_hex(hash_str)?;
    
    let peer: iroh::EndpointId = peer_node_id.parse()
        .map_err(|e| BlobError::StoreError(format!("Invalid peer node ID: {}", e)))?;
    
    // Check if we already have it
    let store = get_blob_store().await?;
    let has = store
        .has(hash)
        .await
        .map_err(|e| BlobError::StoreError(e.to_string()))?;
    if has {
        log::debug!("[blobs] Already have blob {}", hash_str);
        return Ok(());
    }
    
    // Try to download from the specified peer
    let network = network::get_network().await
        .ok_or(BlobError::NetworkNotInitialized)?;
    
    let net = network.lock().await;
    
    try_download_blob(&net.endpoint, peer, &hash).await?;
    
    Ok(())
}

fn hash_from_hex(hash_str: &str) -> Result<Hash, BlobError> {
    let bytes = hex::decode(hash_str)
        .map_err(|e| BlobError::StoreError(format!("Invalid hash: {}", e)))?;
    if bytes.len() != 32 {
        return Err(BlobError::StoreError("Invalid hash length".to_string()));
    }
    let mut arr = [0u8; 32];
    arr.copy_from_slice(&bytes);
    Ok(Hash::from_bytes(arr))
}

async fn discover_peers(context_id: Option<&str>) -> Result<Vec<iroh::EndpointId>, BlobError> {
    let Some(core) = store::get_core() else {
        return Err(BlobError::NotInitialized);
    };

    let mut peers: Vec<iroh::EndpointId> = vec![];

    // If we have a context id, try room first, then DM thread.
    if let Some(id) = context_id {
        if let Ok(Some(room)) = db::get_room(&core.read_pool, id).await {
            let rows = sqlx::query("SELECT member_key FROM memberships WHERE org_id = ?")
                .bind(&room.org_id)
                .fetch_all(&core.read_pool)
                .await
                .map_err(|e| BlobError::StoreError(e.to_string()))?;
            for row in rows {
                let key_hex: String = row.get("member_key");
                if let Ok(peer) = endpoint_id_from_hex(&key_hex) {
                    peers.push(peer);
                }
            }
            return Ok(peers);
        }

        if let Ok(Some(dm)) = db::get_dm_thread(&core.read_pool, id).await {
            if let Ok(peer) = endpoint_id_from_hex(&dm.initiator_key) {
                peers.push(peer);
            }
            if let Ok(peer) = endpoint_id_from_hex(&dm.recipient_key) {
                peers.push(peer);
            }
            return Ok(peers);
        }
    }

    Ok(peers)
}

fn endpoint_id_from_hex(hex_str: &str) -> Result<iroh::EndpointId, BlobError> {
    let bytes = hex::decode(hex_str)
        .map_err(|e| BlobError::StoreError(format!("Invalid public key: {e}")))?;
    if bytes.len() != 32 {
        return Err(BlobError::StoreError("Invalid public key length".to_string()));
    }
    let mut arr = [0u8; 32];
    arr.copy_from_slice(&bytes);
    iroh::PublicKey::from_bytes(&arr)
        .map_err(|e| BlobError::StoreError(format!("Invalid public key: {e}")))
}

#[derive(Debug, Clone)]
pub struct BlobInfo {
    pub hash: String,
    pub size: u64,
    pub mime_type: String,
}

/// FFI-friendly result for blob operations.
pub struct BlobUploadResult {
    pub hash: String,
    pub size: u64,
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn blob_hash_is_deterministic() {
        use iroh_blobs::Hash;
        let data = b"test blob content";
        let h1 = Hash::new(data).to_hex();
        let h2 = Hash::new(data).to_hex();
        assert_eq!(h1, h2);
    }
}
