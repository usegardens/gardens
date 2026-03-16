# Garden "Deploy to Public Key" Plan
## IPFS CID-Based Releases + Cloudflare Workers Control Plane

## Goal

Build a Vercel-like deployment flow where Garden orgs can deploy an application to an **org-controlled public key**, while application artifacts are stored using **IPFS content-addressed storage (CIDs)**.

The system should provide:

- immutable deployments using IPFS CIDs
- signed release manifests
- stable org identity via public keys
- rollback and preview releases
- local compute with distributed shared state
- a Cloudflare Worker acting as the control plane and resolver

The experience should feel like:

### Deploy to Org

`garden.app/sites/{public_key}`


But internally:

- artifacts are stored on IPFS
- releases are referenced by CID
- manifests are signed
- clients verify releases before running

---

# Core Model

## What a deployment is

A deployment is **not a running server**.

A deployment is:

1. a static application bundle
2. published to IPFS
3. producing a root **CID**
4. a signed release manifest referencing that CID
5. a binding between the manifest and an org public key

Example:

- app build → uploaded to IPFS → CID produced
- CID → referenced in release manifest
- manifest → signed by deploy key
- Worker → binds release to org key


The client:

1. resolves org release
2. verifies signed manifest
3. fetches assets from IPFS gateway
4. runs the app locally
5. joins distributed shared state

---

# Architecture Overview

## Cloudflare Components

### Worker (Control Plane)

The Worker is responsible for:

- deployment API
- manifest verification
- org routing
- release resolution
- deploy policy enforcement
- preview and rollback
- selecting IPFS gateways for browsers

The Worker does **not host application assets**.

---

### KV (Routing Layer)

KV stores globally cached routing metadata.

Examples:

- slug:{slug} → public_key
- site:{public_key}:prod → release_id
- site:{public_key}:preview → release_id
- release:{release_id}:cid → <ipfs CID>


KV enables fast read resolution.

---

### Durable Objects (Deployment Coordination)

Each org maps to one Durable Object instance.

Responsibilities:

- deployment lock
- release history
- release promotion
- rollback logic
- deploy audit log
- deploy key verification
- idempotency protection

Durable Objects remain the **authoritative deployment state machine**.

---

# Data Model

## Org Identity

Each org has:

- org_public_key
- org_root_key
- deploy_keys[]
- optional_slug

The **public key is the canonical deployment identity**.

Example:

```
garden.app/sites/{public_key}
```


Slug routes resolve to public keys.

---

# Release Manifest

Each deployment produces a **signed release manifest**.

Example:

```json
{
  "org_public_key": "...",
  "release_id": "...",
  "created_at": "...",
  "commit_sha": "...",
  "ipfs_root_cid": "bafybe...",
  "entrypoint": "/index.html",
  "previous_release_id": "...",
  "channel": "prod",
  "capabilities": {
    "distributed_state": true,
    "requires_auth": false
  },
  "deploy_key_id": "...",
  "signature": "..."
}
```

Notes:

- ipfs_root_cid is the CID of the application bundle
- the manifest itself must be signed
- clients verify the manifest before loading assets

## Asset Layout (IPFS)

When an app bundle is uploaded to IPFS:

Example structure:

```
CID/
  index.html
  assets/
    app.js
    styles.css
    fonts/
```

Example CID:

```
bafybeib4n6y7...
```

Assets resolve as:

```
https://ipfs.io/ipfs/bafybeib4n6y7/index.html
```

Or via custom gateway:

```
https://gateway.garden.app/ipfs/{CID}/index.html
```

## Route Design - Deploy API

```
POST /deploy/{public_key}
```

Deploy a new release for the org.

Responsibilities:

- authenticate caller
- verify deploy key authorization
- verify manifest signature
- ensure CID is valid
- record release through Durable Object
- update channel pointers

```
POST /deploy/{public_key}/promote
```

Promote preview release to production.

```
POST /deploy/{public_key}/rollback
```

Rollback to a previous release.


### Read Routes

```
GET /sites/{public_key}
```

Resolve the current release manifest.

Example response:

```
{
  "public_key": "...",
  "release_id": "...",
  "manifest": {...},
  "cid": "bafybe...",
  "gateway": "https://gateway.garden.app/ipfs/"
}
```

Client then loads:

```
gateway + cid + entrypoint
```

```
GET /sites/{public_key}/releases/{release_id}
```

Return a specific immutable release manifest.

```
GET /sites/{slug}
```

Resolve slug → public key → release.

## Client Runtime Flow

User opens:

```
garden.app/sites/{public_key}
```

Flow:

1. Worker resolves release from KV
2. Worker loads release metadata
3. Worker returns signed manifest
4. Client verifies:
    - manifest signature
    - org public key binding
    - deploy key authorization
5. Client fetches app assets:

```
https://gateway.garden.app/ipfs/{CID}/index.html
```
6. App runs locally
7. App joins distributed state network

## Deployment Security Model

### Root Key

The root org key is used for:

- establishing org identity
- authorizing deploy keys
- revoking deploy keys

This key should never live in CI.

### Deploy Key

CI deployments use delegated deploy keys.

Deploy keys may have constraints:

```
allowed_env = prod|preview
repo = example/repo
expires_at
```

Deploy keys sign the release manifest.

### CI Deployment Flow

Example GitHub Action:

```
build app
↓
upload bundle to IPFS
↓
get CID
↓
generate release manifest
↓
sign manifest with deploy key
↓
POST /deploy/{public_key}
```

Worker verifies:

- deploy key delegation
- signature validity
- CID format
- deploy policy

Durable Object records the release.

### Recommended URL Structure

```
POST /deploy/{public_key}
POST /deploy/{public_key}/promote
POST /deploy/{public_key}/rollback

GET /sites/{public_key}
GET /sites/{public_key}/releases/{release_id}
GET /sites/{slug}

GET /ipfs/{cid}/*
```

### Optional Gateway Strategy

Browsers cannot natively speak IPFS.

The Worker can optionally provide a gateway proxy:

```
gateway.garden.app/ipfs/{cid}
```

Advantages:

- browser compatibility
- caching
- origin control
- performance

### Encrypting the App Bundle (IPFS Assets)

We can encrypt the entire bundle before uploading it to IPFS.

Instead of:

```
bundle → IPFS → CID
```

We can do:

```
bundle
↓
encrypt(bundle)
↓
IPFS → CID
```

Then the client:

```
download encrypted bundle
↓
decrypt locally
↓
run app
```

Manifest example

```
{
  "org_public_key": "...",
  "release_id": "...",
  "ipfs_root_cid": "bafy...",
  "encryption": {
    "algorithm": "xchacha20-poly1305",
    "key_id": "release-key-2026"
  },
  "signature": "..."
}
```

### If the client fetches IPFS directly

Example:

```
Client
↓
IPFS gateway
↓
IPFS network
```

Cloudflare only serves:

```
/sites/{public_key}
```

which returns the manifest. Then the client fetches:

https://ipfs.io/ipfs/{CID}

or another gateway.

In this case Cloudflare never sees the blob at all.

### If blobs are encrypted before IPFS upload

This is the best architecture for confidential deployments.

Flow:

```
bundle
↓
encrypt(bundle)
↓
IPFS
↓
CID
```

Then:

```
Client downloads encrypted blob
↓
decrypt locally
```

Even if Cloudflare proxies the request, they only see:

```
encrypted bytes
```

They cannot read the content.

### Encrypting Per-Org Deployments

You could encrypt releases with a shared org key.

Example:

```
org symmetric key
↓
encrypt release bundle
↓
upload encrypted bundle to IPFS
```

Users who belong to the org receive the key after authentication.

Flow:

```
User opens site
↓
Worker authenticates user
↓
Worker issues encrypted release key
↓
Client decrypts bundle
```

This works well for private internal apps.