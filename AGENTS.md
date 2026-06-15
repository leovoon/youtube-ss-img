# Agent Instructions

These instructions apply to every change in this repository. They are enforced
by the Slophammer quality gates defined in `slophammer.yml` and the CI
workflow at `.github/workflows/ci.yml`. The contract comes from the
Slophammer entrypoint:

  https://raw.githubusercontent.com/dutifuldev/slophammer/refs/heads/main/docs/AGENT_ENTRYPOINT.md

## Repository facts

- **Language**: Rust. Crate type is `cdylib`; the artifact is a Yew UI compiled
  to WebAssembly for a Chrome extension.
- **Target**: `wasm32-unknown-unknown` only. The crate has no host-target
  build and no `#[test]` functions by design.
- **Toolchain**: Rust stable, MSRV `1.75` (see `Cargo.toml`).
- **Slophammer-rs version pinned in CI**: `0.4.0`. Do not use `@latest`; the
  pin lives in `.github/workflows/ci.yml` and must be bumped in one place.

## Local commands agents must run before finishing

Run from the repo root:

```sh
# Format gate
cargo fmt --all -- --check

# Lint gate (deny warnings on the WASM target)
cargo clippy --target wasm32-unknown-unknown --all-targets -- -D warnings

# Build gate
cargo check --target wasm32-unknown-unknown

# Test compile gate (WASM-only target — we cannot execute the .wasm;
# --no-run asserts the test surface still compiles cleanly).
cargo test --target wasm32-unknown-unknown --no-run

# Slophammer structural and policy gates
slophammer-rs dry . --format json
slophammer-rs boundaries . --format json
slophammer-rs unsafe . --format json
slophammer-rs check . --format json
```

`slophammer-rs@0.4.0` must be installed locally:

```sh
cargo install slophammer-rs --locked --version 0.4.0
```

CI installs the same pinned version, so local results match CI exactly.

## Architecture rules

- **Unsafe is forbidden.** Do not add `unsafe { ... }` blocks. The
  `slophammer-rs unsafe .` gate enforces `policy: forbid` from `slophammer.yml`.
  If you genuinely need unsafe, the policy must be widened deliberately, not
  by sneaking an `unsafe` block past review.
- **No new public dependencies without justification.** The crate already pulls
  in `yew`, `wasm-bindgen`, `serde`, `gloo`, `web-sys`, and `js-sys`. Anything
  new should be evaluated against the standard library and existing deps
  first. New deps must compile on `wasm32-unknown-unknown` and add no `unsafe`
  exposure.
- **Keep domain logic separate from `web_sys`.** Bridge calls
  (`Reflect::get`, `JsFuture::from`, `spawn_local`) belong in narrow functions
  next to the UI component that needs them. Do not thread `web_sys` types into
  pure data helpers.
- **Do not weaken CI to make a change pass.** If a gate fails, fix the code.

## Testing expectations

- There are no `#[test]` functions today. `cargo test` exits `0` on an empty
  test suite, so it is wired into CI as a present-but-inactive gate.
- When you add behavior, add a host-target test alongside it. WASM-target
  tests are not yet wired in; keep logic that is worth testing in code paths
  the host can call (e.g. pure-data helpers, validation, frame-rotation math)
  and test those.
- **Coverage and mutation are deliberately deferred.** Both require a
  host-target build that this `cdylib` does not currently produce. Adding
  one is a structural change and should be its own PR, not folded into a
  feature change. The path is:
  1. Add a small `[[bin]]` or `[[example]]` that exercises pure logic.
  2. Wire `cargo llvm-cov --fail-under-lines 85` and a mutation runner into
     CI.
  Until then, the coverage and mutation rules will continue to flag in
  `slophammer-rs check .` output, and that is the documented state of the
  repo.

## Refactoring order when a gate fails

1. Add missing tests for the behavior that broke.
2. Split high-complexity functions by responsibility. The auto-capture
   `on_start_auto_capture` closure in `src/lib.rs` is the obvious first
   target if `slophammer-rs` flags complexity.
3. Move `web_sys` and `Closure` plumbing away from pure data handling.
4. Replace repeated code with a named helper only when the helper has a
   stable purpose.
5. Remove dead or unused paths.
6. Re-run the failing gate.

Do not refactor unrelated areas because you noticed them.

## Build and release

The build is `node build.js` from the repo root. It runs `wasm-pack` and
packages `extension/` into `release/youtube-frame-grab-alpha-v0.<X>.zip`.
Version bumps live in `Cargo.toml`; the build script reads it.

## Pointer back to the entrypoint

If you are an agent and these instructions feel incomplete or wrong, the
authoritative source is:

  https://raw.githubusercontent.com/dutifuldev/slophammer/refs/heads/main/docs/AGENT_ENTRYPOINT.md

Follow it. Do not invent rules the tool chain cannot check.
