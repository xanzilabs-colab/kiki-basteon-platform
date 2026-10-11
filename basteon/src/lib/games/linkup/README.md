# Kiki Links

Kiki Links reuses `game_rooms` for the Buddy radar, invite, and acceptance flow. Both players tap Ready before a Buddy match begins. Kiki matches use the same server-controlled match API with easy, medium, or hard difficulty.

## Modes

- **Classic:** ten rounds of racing to find a valid word between two picked letters.
- **Minefield:** the answer cannot contain either of the two revealed mine letters.
- **Chain:** after round one, the fastest valid word's final letter carries into the next round. No valid answer breaks the chain and restores normal start-letter picking.
- **Wildcard:** each answer gets one modifier: long word (7+ letters, 2x), no A/O, or steal (answer in under one second).
- **Hot Potato:** one shared fuse runs only while a player holds the bomb. Correct answers pass it and add two seconds; invalid answers keep the letters and cost two seconds.

Classic modes use pick/reveal/answer/result phases, ten rounds, and one classic sudden-death round on a tie. Validation, timestamps, bot delays, scoring, and fuse resolution are server-owned.

## Dictionary

`words.ts` contains a compact built-in starter word list maintained in this repository; there is no external dataset dependency. It should be expanded before broad production launch. The same words are used by player validation and Kiki.

## Adding a mode

Add it to `Mode` and `buildSpec` in `engine.ts`, provide a mode card and explanation in `LinkupLobby.tsx`, connect presentation in `LinkupMatch.tsx`, and update the migration's supported-mode constraints. Keep validation, timing, and resolution on the server.

## Local checks

```powershell
npm test -- src/lib/games/linkup/engine.test.ts
npm run build
```

Apply the Supabase migration before playing. Buddy rooms also rely on the existing radar presence and invitation migrations.
