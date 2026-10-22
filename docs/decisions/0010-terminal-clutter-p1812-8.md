# 0010 — Clutter at the terminals the P.1812-8 way, with a dense near-terminal profile

**Date:** 22 Oct 2026 · **Status:** accepted · **Supersedes:** the terminal-clutter part of ADR 0005 · **Context:** ITU validation (`docs/validation-p1812.md`)

## Problem

The engine kept the P.1812-6 §4.7 terminal clutter loss: a knife-edge
height-gain term added at each end when an antenna stands below the local
clutter height. P.1812-7/-8 dropped it: terminals stay bare and clutter
along the profile blocks the path through the Bullington construction. In
the ITU validation set this was the only remaining deviation besides
ducting — up to +57 dB in urban cases at 6 GHz.

We had kept -6 because our profiles are sampled about 1 km apart: with -8
alone, the clutter right around a handheld would fall between samples and
not count at all.

## Decision

- `p1812Loss` follows -8: no terminal clutter term (eq. 69: Lb = max(Lb0p,
  Lbc)); terminals bare, clutter in the Bullington profile only.
- `buildProfileP1812` adds samples at 25, 50, 100, 200 and 400 m from both
  ends wherever the ~1 km grid is coarser, so clutter next to a terminal is
  in the profile the -8 method reads.

## Consequences

- Validation: final loss within 0.1 dB in 61 of 63 ITU cases (was 47); the
  two others are the omitted ducting term (+14.4 dB, safe side).
- Coverage with clutter is somewhat less pessimistic: P.1812 in Amsterdam
  (450 MHz, 8 W, 20 m mast, buildings + trees) covers 73% vs 64% with the
  -6 term and 100% without clutter.
- Up to 10 extra profile points per path; compute time barely changes
  (Amsterdam 150×150 cells: 0.23 s compute).
- The FSPL+Deygout fallback engine is unchanged: it still applies clutter as
  a dB term at the receiver.
