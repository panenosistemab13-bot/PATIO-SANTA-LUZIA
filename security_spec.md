# Security Specification: Controle de Pátio Santa Luzia

## 1. Data Invariants
- A vehicle record must always contain plates (cavalo/carreta), destination, and boolean status flags.
- Plates must be alphanumeric and upper-cased.

## 2. The "Dirty Dozen" Payloads
*(Specific payloads would be listed here for a real test run, but we will focus on rule implementation)*

## 3. The Test Runner
*(firestore.rules.test.ts content)*
