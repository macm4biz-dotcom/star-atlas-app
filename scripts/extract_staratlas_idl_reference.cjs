#!/usr/bin/env node
/*
Extract practical account metadata from installed Star Atlas SDK IDLs:
- account discriminator (hex + base58 memcmp bytes)
- static account size estimate (8 discriminator + fixed struct bytes)
- fixed field offsets for simple account structs

Output:
  scripts/star_atlas_idl_reference.generated.json
*/

const crypto = require('crypto');
const bs58 = require('bs58');

const cargoSdk = require('@staratlas/cargo/dist/src');
const sageSdk = require('@staratlas/sage/dist/src');

const CARGO_IDL = cargoSdk.CARGO_IDL;
const SAGE_IDL = sageSdk.SAGE_IDL;

function accountDiscriminator(name) {
  const preimage = `account:${name}`;
  return crypto.createHash('sha256').update(preimage).digest().subarray(0, 8);
}

function fixedTypeSize(type) {
  if (typeof type === 'string') {
    if (type === 'u8' || type === 'i8' || type === 'bool') return 1;
    if (type === 'u16' || type === 'i16') return 2;
    if (type === 'u32' || type === 'i32' || type === 'f32') return 4;
    if (type === 'u64' || type === 'i64' || type === 'f64') return 8;
    if (type === 'u128' || type === 'i128') return 16;
    if (type === 'publicKey') return 32;
    if (type === 'bytes') return null;
    return null;
  }

  if (type && typeof type === 'object') {
    if (type.array) {
      const [inner, length] = type.array;
      const innerSize = fixedTypeSize(inner);
      if (innerSize == null || typeof length !== 'number') return null;
      return innerSize * length;
    }
    if (type.option || type.vec || type.defined) {
      return null;
    }
  }

  return null;
}

function fixedFieldOffsets(accountDef) {
  if (!accountDef || !accountDef.type || accountDef.type.kind !== 'struct') return null;

  const offsets = {};
  let cursor = 8; // Anchor discriminator

  for (const field of accountDef.type.fields || []) {
    const size = fixedTypeSize(field.type);
    if (size == null) {
      offsets[field.name] = null;
      return { offsets, minDataSize: null, note: 'dynamic_or_defined_field_encountered' };
    }
    offsets[field.name] = cursor;
    cursor += size;
  }

  return { offsets, minDataSize: cursor, note: 'fixed_struct' };
}

function mapAccount(idl, name, extra = {}) {
  const account = (idl.accounts || []).find((a) => a.name === name);
  if (!account) return null;

  const disc = accountDiscriminator(name);
  const fixed = fixedFieldOffsets(account);

  return {
    accountName: name,
    discriminatorHex: `0x${disc.toString('hex')}`,
    discriminatorBase58: bs58.encode(disc),
    minDataSize: fixed ? fixed.minDataSize : null,
    offsets: fixed ? fixed.offsets : null,
    note: fixed ? fixed.note : 'unknown',
    ...extra,
  };
}

function build() {
  const generatedAt = new Date().toISOString();

  const cargoAccounts = [
    mapAccount(CARGO_IDL, 'cargoPod', {
      sdkMinDataSize: cargoSdk.CargoPod?.MIN_DATA_SIZE ?? null,
      sdkOffsetConstant: cargoSdk.CARGO_POD_OFFSET ?? null,
      docs: 'Cargo pod has dynamic trailing u64 stats array decoded in SDK.',
    }),
    mapAccount(CARGO_IDL, 'cargoType', {
      sdkMinDataSize: cargoSdk.CargoType?.MIN_DATA_SIZE ?? null,
      sdkOffsetConstant: cargoSdk.CARGO_TYPE_OFFSET ?? null,
      docs: 'Cargo type has trailing dynamic stats values (u64 vector).',
    }),
    mapAccount(CARGO_IDL, 'cargoStatsDefinition', {
      sdkMinDataSize: cargoSdk.CargoStatsDefinition?.MIN_DATA_SIZE ?? null,
      docs: 'Stats definition contains static header; semantic meaning of stat indexes is external.',
    }),
  ].filter(Boolean);

  const sageAccounts = [
    mapAccount(SAGE_IDL, 'resource', {
      sdkMinDataSize: sageSdk.Resource?.MIN_DATA_SIZE ?? null,
      docs: 'Contains amountMined and numMiners for mineable resources.',
    }),
    mapAccount(SAGE_IDL, 'mineItem', {
      sdkMinDataSize: sageSdk.MineItem?.MIN_DATA_SIZE ?? null,
      docs: 'Contains mint and resourceHardness metadata.',
    }),
    mapAccount(SAGE_IDL, 'fleet', {
      sdkMinDataSize: sageSdk.Fleet?.MIN_DATA_SIZE ?? null,
      docs: 'Contains cargoHold/fuelTank/ammoBank cargo pod addresses.',
    }),
    mapAccount(SAGE_IDL, 'sagePlayerProfile', {
      sdkMinDataSize: sageSdk.SagePlayerProfile?.MIN_DATA_SIZE ?? null,
      docs: 'Maps player profile to game context.',
    }),
    mapAccount(SAGE_IDL, 'starbasePlayer', {
      sdkMinDataSize: sageSdk.StarbasePlayer?.MIN_DATA_SIZE ?? null,
      docs: 'Contains player-starbase relation and dynamic escrow records.',
    }),
  ].filter(Boolean);

  return {
    generatedAt,
    source: {
      cargoPackage: '@staratlas/cargo',
      sagePackage: '@staratlas/sage',
      note: 'Derived from installed SDK IDL and Anchor discriminator rule.',
    },
    cargoAccounts,
    sageAccounts,
  };
}

function main() {
  const payload = build();
  const fs = require('fs');
  const path = require('path');
  const outPath = path.resolve(process.cwd(), 'scripts/star_atlas_idl_reference.generated.json');
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`generated: ${outPath}`);
}

main();
