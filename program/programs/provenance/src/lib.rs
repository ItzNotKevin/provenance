//! Provenance Camera — on-chain attestation program (Solana / Anchor).
//!
//! One PDA per photo, seeded `["photo", sha256]`, so the chain is a content-addressed
//! lookup table: derive the address from the hash, read it in one RPC call, no search.
//!
//! STATUS: reference skeleton. Structure + account layout + duplicate rejection are solid,
//! but the ed25519 signature introspection MUST be tested on devnet with a real device
//! signature before trusting it — the instruction-sysvar layout is the fiddliest part of
//! the whole project (the plan flags this explicitly). See program/README.md.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    ed25519_program,
    sysvar::instructions::{load_instruction_at_checked, ID as INSTRUCTIONS_SYSVAR_ID},
};

// Program id (keypair at target/deploy/provenance-keypair.json). Regenerate + `anchor keys sync` if redeploying fresh.
declare_id!("EoWdDXF8NNnHryWFmnJazobruBvHPhZhKRR7YfrWjZ8g");

#[program]
pub mod provenance {
    use super::*;

    /// Records an attestation for one photo. Fails if an attestation for this exact
    /// SHA-256 already exists (the `init` on a hash-seeded PDA gives duplicate rejection
    /// for free — nobody can re-attest someone else's photo later).
    ///
    /// The device signs a canonical message (see `canonical_message`) with its Ed25519
    /// key. The client attaches a native Ed25519 verify instruction to the SAME
    /// transaction; here we introspect the instructions sysvar to confirm that verify
    /// covered *this* device pubkey and *this* message. The precompile already checked
    /// the signature math — we only bind it to our expected pubkey + message.
    pub fn attest_photo(
        ctx: Context<AttestPhoto>,
        sha256: [u8; 32],
        phash: u64,
        timestamp: i64,
        parent_hash: Option<[u8; 32]>,
    ) -> Result<()> {
        let device_pubkey = ctx.accounts.device.key();

        // Rebuild the exact bytes the device signed and confirm the co-submitted Ed25519
        // precompile instruction verified them for this device key.
        let message = canonical_message(&sha256, timestamp, &device_pubkey);
        verify_ed25519(
            &ctx.accounts.instructions_sysvar,
            &device_pubkey.to_bytes(),
            &message,
        )?;

        let record = &mut ctx.accounts.attestation;
        record.sha256 = sha256;
        record.phash = phash; // backend-asserted (evidence-only amber tier); not device-signed in v1
        record.device_pubkey = device_pubkey;
        record.timestamp = timestamp;
        record.parent_hash = parent_hash;
        record.slot = Clock::get()?.slot;
        record.bump = ctx.bumps.attestation;

        emit!(PhotoAttested {
            sha256,
            device_pubkey,
            timestamp,
            slot: record.slot,
        });
        Ok(())
    }
}

/// Canonical signed message = sha256(32) ‖ timestamp_le(8) ‖ device_pubkey(32).
/// FIXED byte layout on purpose — never JSON. The capture app MUST sign these exact
/// bytes (see program/README.md "Signing contract"); today the app signs JSON and must
/// be switched to this before the on-chain verify can pass.
fn canonical_message(sha256: &[u8; 32], timestamp: i64, device_pubkey: &Pubkey) -> Vec<u8> {
    let mut msg = Vec::with_capacity(32 + 8 + 32);
    msg.extend_from_slice(sha256);
    msg.extend_from_slice(&timestamp.to_le_bytes());
    msg.extend_from_slice(&device_pubkey.to_bytes());
    msg
}

#[derive(Accounts)]
#[instruction(sha256: [u8; 32])]
pub struct AttestPhoto<'info> {
    /// The photo attestation PDA — `init` fails if it already exists (duplicate rejection).
    #[account(
        init,
        payer = fee_payer,
        space = 8 + PhotoAttestation::MAX_SIZE,
        seeds = [b"photo", sha256.as_ref()],
        bump
    )]
    pub attestation: Account<'info, PhotoAttestation>,

    /// The device identity key (Ed25519). Not a transaction signer — the device signs the
    /// manifest off-chain; the backend fee-payer signs the transaction. Passed so we can
    /// bind the introspected Ed25519 verify to it.
    /// CHECK: used only as a 32-byte pubkey compared against the ed25519 instruction.
    pub device: UncheckedAccount<'info>,

    /// Backend co-signer + rent payer (sponsored-transaction pattern; users hold no SOL).
    #[account(mut)]
    pub fee_payer: Signer<'info>,

    /// Instructions sysvar — read to introspect the co-submitted Ed25519 verify instruction.
    /// CHECK: address is constrained to the instructions sysvar id.
    #[account(address = INSTRUCTIONS_SYSVAR_ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[account]
pub struct PhotoAttestation {
    pub sha256: [u8; 32],
    pub phash: u64,
    pub device_pubkey: Pubkey,
    pub timestamp: i64,
    pub parent_hash: Option<[u8; 32]>,
    pub slot: u64,
    pub bump: u8,
}

impl PhotoAttestation {
    // 32 + 8 + 32 + 8 + (1 + 32) + 8 + 1
    pub const MAX_SIZE: usize = 32 + 8 + 32 + 8 + 33 + 8 + 1;
}

#[event]
pub struct PhotoAttested {
    pub sha256: [u8; 32],
    pub device_pubkey: Pubkey,
    pub timestamp: i64,
    pub slot: u64,
}

#[error_code]
pub enum AttestError {
    #[msg("No Ed25519 verify instruction found in this transaction")]
    MissingEd25519Instruction,
    #[msg("Ed25519 instruction is malformed")]
    MalformedEd25519Instruction,
    #[msg("Ed25519 verify did not cover the expected device pubkey")]
    DevicePubkeyMismatch,
    #[msg("Ed25519 verify did not cover the expected manifest message")]
    MessageMismatch,
}

/// Scans the transaction's instructions for a native Ed25519 precompile verify and
/// confirms it covered `expected_pubkey` over `expected_message`.
///
/// Ed25519 precompile instruction data layout (single signature):
///   [0]      u8   number of signatures (>= 1)
///   [1]      u8   padding
///   [2..4]   u16  signature_offset            (LE)
///   [4..6]   u16  signature_instruction_index (LE)
///   [6..8]   u16  public_key_offset           (LE)
///   [8..10]  u16  public_key_instruction_index
///   [10..12] u16  message_data_offset         (LE)
///   [12..14] u16  message_data_size           (LE)
///   [14..16] u16  message_instruction_index
/// followed by the referenced pubkey(32) ‖ signature(64) ‖ message bytes.
/// For a self-contained instruction the *_instruction_index fields are u16::MAX.
fn verify_ed25519(
    instructions_sysvar: &UncheckedAccount,
    expected_pubkey: &[u8; 32],
    expected_message: &[u8],
) -> Result<()> {
    let mut index: usize = 0;
    loop {
        let ix = match load_instruction_at_checked(index, instructions_sysvar) {
            Ok(ix) => ix,
            Err(_) => return err!(AttestError::MissingEd25519Instruction),
        };
        index += 1;

        if ix.program_id != ed25519_program::ID {
            continue;
        }
        let data = &ix.data;
        require!(data.len() >= 16, AttestError::MalformedEd25519Instruction);

        let read_u16 = |lo: usize| u16::from_le_bytes([data[lo], data[lo + 1]]) as usize;
        let pubkey_offset = read_u16(6);
        let msg_offset = read_u16(10);
        let msg_size = read_u16(12);

        require!(
            pubkey_offset + 32 <= data.len() && msg_offset + msg_size <= data.len(),
            AttestError::MalformedEd25519Instruction
        );

        let pubkey = &data[pubkey_offset..pubkey_offset + 32];
        require!(pubkey == expected_pubkey, AttestError::DevicePubkeyMismatch);

        let message = &data[msg_offset..msg_offset + msg_size];
        require!(message == expected_message, AttestError::MessageMismatch);

        // Precompile already verified the signature for (pubkey, message); binding done.
        return Ok(());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_message_layout() {
        let sha = [7u8; 32];
        let ts: i64 = 1_700_000_000;
        let pk = Pubkey::new_from_array([9u8; 32]);
        let msg = canonical_message(&sha, ts, &pk);

        // sha256(32) ‖ timestamp_i64_LE(8) ‖ device_pubkey(32) = 72 bytes.
        // Keep this identical to lib/manifest.ts canonicalManifestBytes().
        assert_eq!(msg.len(), 72);
        assert_eq!(&msg[0..32], &sha);
        assert_eq!(&msg[32..40], &ts.to_le_bytes());
        assert_eq!(&msg[40..72], &pk.to_bytes());
    }

    #[test]
    fn account_size_is_exact() {
        assert_eq!(PhotoAttestation::MAX_SIZE, 32 + 8 + 32 + 8 + 33 + 8 + 1);
    }
}
