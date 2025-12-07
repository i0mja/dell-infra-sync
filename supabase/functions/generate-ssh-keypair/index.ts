import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import * as ed25519 from "https://esm.sh/@noble/ed25519@2.0.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Generate SSH Ed25519 Key Pair
 * 
 * Creates an Ed25519 key pair in OpenSSH format suitable for SSH authentication.
 * Returns both public key (for adding to authorized_keys) and private key
 * (for storing encrypted in the database).
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Parse request body for optional comment and fingerprint option
    let comment = 'zfsadmin@zfs-target';
    let returnFingerprint = false;
    try {
      const body = await req.json();
      if (body.comment) {
        comment = body.comment;
      }
      if (body.returnFingerprint) {
        returnFingerprint = true;
      }
    } catch {
      // Use default comment if no body or invalid JSON
    }

    // Generate Ed25519 key pair using noble/ed25519
    const privateKeyBytes = ed25519.utils.randomPrivateKey();
    const publicKeyBytes = await ed25519.getPublicKeyAsync(privateKeyBytes);

    // Format public key in OpenSSH format: ssh-ed25519 <base64-key> <comment>
    const publicKeyBase64 = formatPublicKeyOpenSSH(publicKeyBytes);
    const publicKey = `ssh-ed25519 ${publicKeyBase64} ${comment}`;

    // Format private key in OpenSSH format
    const privateKey = formatPrivateKeyOpenSSH(privateKeyBytes, publicKeyBytes, comment);

    // Calculate SHA256 fingerprint of the public key
    let fingerprint = '';
    if (returnFingerprint) {
      fingerprint = await calculateFingerprint(publicKeyBytes);
    }

    console.log('Generated SSH Ed25519 key pair successfully');

    const response: Record<string, string> = {
      publicKey,
      privateKey,
      keyType: 'ed25519',
      comment
    };

    if (returnFingerprint) {
      response.fingerprint = fingerprint;
    }

    return new Response(
      JSON.stringify(response),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error generating SSH key pair:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Failed to generate SSH key pair' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

/**
 * Format Ed25519 public key in OpenSSH format (base64 encoded)
 * OpenSSH public key format: string length (4 bytes) + "ssh-ed25519" + key length (4 bytes) + key bytes
 */
function formatPublicKeyOpenSSH(publicKey: Uint8Array): string {
  const keyType = 'ssh-ed25519';
  const keyTypeBytes = new TextEncoder().encode(keyType);
  
  // Calculate total buffer size
  const bufferSize = 4 + keyTypeBytes.length + 4 + publicKey.length;
  const buffer = new Uint8Array(bufferSize);
  let offset = 0;

  // Write key type length and key type
  writeUint32BE(buffer, keyTypeBytes.length, offset);
  offset += 4;
  buffer.set(keyTypeBytes, offset);
  offset += keyTypeBytes.length;

  // Write public key length and public key
  writeUint32BE(buffer, publicKey.length, offset);
  offset += 4;
  buffer.set(publicKey, offset);

  return base64Encode(buffer);
}

/**
 * Format Ed25519 private key in OpenSSH format
 * This creates a PEM-formatted private key with the OpenSSH proprietary format
 */
function formatPrivateKeyOpenSSH(privateKey: Uint8Array, publicKey: Uint8Array, comment: string): string {
  const keyType = 'ssh-ed25519';
  const keyTypeBytes = new TextEncoder().encode(keyType);
  const commentBytes = new TextEncoder().encode(comment);
  const authMagic = new TextEncoder().encode('openssh-key-v1\0');
  const cipherName = new TextEncoder().encode('none');
  const kdfName = new TextEncoder().encode('none');
  
  // Generate random check integers (same value for both, as per OpenSSH spec for unencrypted keys)
  const checkInt = crypto.getRandomValues(new Uint8Array(4));
  
  // Build the public key section (same format as the public key blob)
  const pubKeyBlob = new Uint8Array(4 + keyTypeBytes.length + 4 + publicKey.length);
  let pubOffset = 0;
  writeUint32BE(pubKeyBlob, keyTypeBytes.length, pubOffset);
  pubOffset += 4;
  pubKeyBlob.set(keyTypeBytes, pubOffset);
  pubOffset += keyTypeBytes.length;
  writeUint32BE(pubKeyBlob, publicKey.length, pubOffset);
  pubOffset += 4;
  pubKeyBlob.set(publicKey, pubOffset);

  // Build the private section (unpadded for now)
  // Format: check1 + check2 + keytype_len + keytype + pubkey_len + pubkey + 
  //         privkey_len + privkey(64 bytes = 32 private + 32 public) + comment_len + comment
  const privKeyFull = new Uint8Array(64); // Ed25519 private key format: 32 bytes seed + 32 bytes public
  privKeyFull.set(privateKey, 0);
  privKeyFull.set(publicKey, 32);

  const privateSectionSize = 
    4 + 4 + // check integers
    4 + keyTypeBytes.length + // key type
    4 + publicKey.length + // public key
    4 + privKeyFull.length + // private key (seed + pub)
    4 + commentBytes.length; // comment

  // Add padding to make it a multiple of 8
  const paddingLength = (8 - (privateSectionSize % 8)) % 8;
  const paddedPrivateSectionSize = privateSectionSize + paddingLength;

  const privateSection = new Uint8Array(paddedPrivateSectionSize);
  let privOffset = 0;

  // Check integers (same random value twice)
  privateSection.set(checkInt, privOffset);
  privOffset += 4;
  privateSection.set(checkInt, privOffset);
  privOffset += 4;

  // Key type
  writeUint32BE(privateSection, keyTypeBytes.length, privOffset);
  privOffset += 4;
  privateSection.set(keyTypeBytes, privOffset);
  privOffset += keyTypeBytes.length;

  // Public key
  writeUint32BE(privateSection, publicKey.length, privOffset);
  privOffset += 4;
  privateSection.set(publicKey, privOffset);
  privOffset += publicKey.length;

  // Private key (seed + public)
  writeUint32BE(privateSection, privKeyFull.length, privOffset);
  privOffset += 4;
  privateSection.set(privKeyFull, privOffset);
  privOffset += privKeyFull.length;

  // Comment
  writeUint32BE(privateSection, commentBytes.length, privOffset);
  privOffset += 4;
  privateSection.set(commentBytes, privOffset);
  privOffset += commentBytes.length;

  // Padding bytes (1, 2, 3, 4, ...)
  for (let i = 0; i < paddingLength; i++) {
    privateSection[privOffset + i] = i + 1;
  }

  // Build the full key file
  const fullKeySize = 
    authMagic.length +
    4 + cipherName.length + // cipher name
    4 + kdfName.length + // kdf name
    4 + // kdf options (empty string)
    4 + // number of keys (1)
    4 + pubKeyBlob.length + // public key blob
    4 + privateSection.length; // private section

  const fullKey = new Uint8Array(fullKeySize);
  let offset = 0;

  // Auth magic
  fullKey.set(authMagic, offset);
  offset += authMagic.length;

  // Cipher name
  writeUint32BE(fullKey, cipherName.length, offset);
  offset += 4;
  fullKey.set(cipherName, offset);
  offset += cipherName.length;

  // KDF name
  writeUint32BE(fullKey, kdfName.length, offset);
  offset += 4;
  fullKey.set(kdfName, offset);
  offset += kdfName.length;

  // KDF options (empty)
  writeUint32BE(fullKey, 0, offset);
  offset += 4;

  // Number of keys
  writeUint32BE(fullKey, 1, offset);
  offset += 4;

  // Public key blob
  writeUint32BE(fullKey, pubKeyBlob.length, offset);
  offset += 4;
  fullKey.set(pubKeyBlob, offset);
  offset += pubKeyBlob.length;

  // Private section
  writeUint32BE(fullKey, privateSection.length, offset);
  offset += 4;
  fullKey.set(privateSection, offset);

  // Base64 encode and format with line breaks
  const base64Key = base64Encode(fullKey);
  const formattedBase64 = base64Key.match(/.{1,70}/g)?.join('\n') || base64Key;

  return `-----BEGIN OPENSSH PRIVATE KEY-----\n${formattedBase64}\n-----END OPENSSH PRIVATE KEY-----\n`;
}

/**
 * Write a 32-bit unsigned integer in big-endian format
 */
function writeUint32BE(buffer: Uint8Array, value: number, offset: number): void {
  buffer[offset] = (value >> 24) & 0xff;
  buffer[offset + 1] = (value >> 16) & 0xff;
  buffer[offset + 2] = (value >> 8) & 0xff;
  buffer[offset + 3] = value & 0xff;
}

/**
 * Base64 encode a Uint8Array
 */
function base64Encode(data: Uint8Array): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  
  for (let i = 0; i < data.length; i += 3) {
    const a = data[i];
    const b = data[i + 1] ?? 0;
    const c = data[i + 2] ?? 0;
    
    const triplet = (a << 16) | (b << 8) | c;
    
    result += chars[(triplet >> 18) & 0x3f];
    result += chars[(triplet >> 12) & 0x3f];
    result += i + 1 < data.length ? chars[(triplet >> 6) & 0x3f] : '=';
    result += i + 2 < data.length ? chars[triplet & 0x3f] : '=';
  }
  
  return result;
}

/**
 * Calculate SHA256 fingerprint of the public key in OpenSSH format
 * Returns format: SHA256:<base64-hash>
 */
async function calculateFingerprint(publicKey: Uint8Array): Promise<string> {
  const keyType = 'ssh-ed25519';
  const keyTypeBytes = new TextEncoder().encode(keyType);
  
  // Build the public key blob (same as in formatPublicKeyOpenSSH)
  const bufferSize = 4 + keyTypeBytes.length + 4 + publicKey.length;
  const buffer = new Uint8Array(bufferSize);
  let offset = 0;

  writeUint32BE(buffer, keyTypeBytes.length, offset);
  offset += 4;
  buffer.set(keyTypeBytes, offset);
  offset += keyTypeBytes.length;
  writeUint32BE(buffer, publicKey.length, offset);
  offset += 4;
  buffer.set(publicKey, offset);

  // Calculate SHA256 hash
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = new Uint8Array(hashBuffer);
  
  // Convert to base64 and format as OpenSSH fingerprint
  const base64Hash = base64Encode(hashArray).replace(/=+$/, '');
  return `SHA256:${base64Hash}`;
}
