import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

// Keep checkpoint hashes identical to the Electron version without shipping Node.
export const hashText = (value: string): string => bytesToHex(sha256(utf8ToBytes(value)));
