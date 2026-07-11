// Generates target/idl/provenance.json deterministically (Anchor 0.30 IDL format).
// Needed because `anchor idl build` force-downgrades Solana on this toolchain; the IDL
// is fully determined by the program, and Anchor discriminators are just sha256 prefixes.
import { createHash } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";

const disc = (s) => Array.from(createHash("sha256").update(s).digest().subarray(0, 8));

const ADDRESS = "EoWdDXF8NNnHryWFmnJazobruBvHPhZhKRR7YfrWjZ8g";
const sha256Ty = { array: ["u8", 32] };

const idl = {
  address: ADDRESS,
  metadata: {
    name: "provenance",
    version: "0.1.0",
    spec: "0.1.0",
    description: "Provenance Camera photo attestation",
  },
  instructions: [
    {
      name: "attest_photo",
      discriminator: disc("global:attest_photo"),
      accounts: [
        { name: "attestation", writable: true },
        { name: "device" },
        { name: "fee_payer", writable: true, signer: true },
        { name: "instructions_sysvar", address: "Sysvar1nstructions1111111111111111111111111" },
        { name: "system_program", address: "11111111111111111111111111111111" },
      ],
      args: [
        { name: "sha256", type: sha256Ty },
        { name: "phash", type: "u64" },
        { name: "timestamp", type: "i64" },
        { name: "parent_hash", type: { option: sha256Ty } },
      ],
    },
  ],
  accounts: [{ name: "PhotoAttestation", discriminator: disc("account:PhotoAttestation") }],
  events: [{ name: "PhotoAttested", discriminator: disc("event:PhotoAttested") }],
  types: [
    {
      name: "PhotoAttestation",
      type: {
        kind: "struct",
        fields: [
          { name: "sha256", type: sha256Ty },
          { name: "phash", type: "u64" },
          { name: "device_pubkey", type: "pubkey" },
          { name: "timestamp", type: "i64" },
          { name: "parent_hash", type: { option: sha256Ty } },
          { name: "slot", type: "u64" },
          { name: "bump", type: "u8" },
        ],
      },
    },
    {
      name: "PhotoAttested",
      type: {
        kind: "struct",
        fields: [
          { name: "sha256", type: sha256Ty },
          { name: "device_pubkey", type: "pubkey" },
          { name: "timestamp", type: "i64" },
          { name: "slot", type: "u64" },
        ],
      },
    },
  ],
};

mkdirSync(new URL("../target/idl/", import.meta.url), { recursive: true });
writeFileSync(
  new URL("../target/idl/provenance.json", import.meta.url),
  JSON.stringify(idl, null, 2)
);
console.log("wrote target/idl/provenance.json");
console.log("attest_photo disc:", idl.instructions[0].discriminator.join(","));
console.log("PhotoAttestation disc:", idl.accounts[0].discriminator.join(","));
