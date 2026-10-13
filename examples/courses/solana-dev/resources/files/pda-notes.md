# Program Derived Addresses

A Program Derived Address (PDA) is an account address derived deterministically from a set of seeds and a program id.
PDAs are intentionally off the ed25519 curve, so no private key exists for them.

## Bump seeds

`find_program_address` starts at bump 255 and decrements until the derived address is off-curve.
The first bump that works is called the canonical bump. Store it to save compute.

## Signing

Only the program that derived a PDA can sign for it, using `invoke_signed` with the same seeds.
