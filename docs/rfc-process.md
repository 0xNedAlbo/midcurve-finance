# RFC Process

**Status:** accepted
**Date:** 2026-05-07
**Slug:** rfc-process

## Purpose

Dieses Dokument definiert, wie Features in diesem Projekt geplant, implementiert und dokumentiert werden — von der Idee bis zur Whitepaper-Referenz. Ziel ist ein schlanker Ablauf, der die Interaktion mit dem Coding Agent vereinheitlicht und gleichzeitig eine schrittweise wachsende Feature-Dokumentation produziert.

## Drei Artefakte

Ein Feature durchläuft bis zu drei Dokumentations-Stadien mit unterschiedlichem Detailgrad und Zeitpunkt:

| Artefakt | Wann | Wo | Zweck |
|---|---|---|---|
| **Coding Spec** | Vor Implementierung | GitHub Issue | Briefing für den Coding Agent |
| **Konzept-Dokument** | Nach Implementierung | Chat-Download (optional in Projektdateien) | Lightweight Feature-Doku zur Referenz |
| **RFC / Whitepaper** | Nach Reifung in Produktion | Chat-Download (optional in Projektdateien) | Vollständige technische Beschreibung mit Mathematik; ggf. Grundlage für User-Doku |

Konzept-Dokument und RFC sind optional und werden nach Bedarf erstellt. Der Trigger für das RFC bleibt explizit offen — es entsteht, wenn das Feature stabil genug ist, dass eine vollständige Dokumentation den Aufwand rechtfertigt.

## Nummerierung

`SPEC-NNNN` ist die kanonische Nummer für die initiale Coding Spec eines Features. Spätere Ergänzungen zum selben Feature: `SPEC-NNNNa`, `SPEC-NNNNb`, etc. Das spätere RFC zum selben Feature trägt dieselbe Nummer (`RFC-NNNN`).

GitHub-Issue-Nummern sind ein internes Artefakt — in Cross-References zwischen Dokumenten die `SPEC-NNNN`/`RFC-NNNN`-Nummer verwenden, GitHub-Notation (`#42`) nur für GitHub-interne Links.

## Workflow

### 1. Konzept (Chat)

Brainstorming und Konzeptfindung passieren im Chat. Sketches, Sackgassen, Gegenbeispiele sind erwartet. Kein Dokument, kein Cleanup.

### 2. Coding Spec (Chat → GitHub)

Wenn das Konzept tragfähig ist, erstellt der Assistant die Coding Spec als herunterladbare MD-Datei im Chat. Iteration im Chat bis finalisiert. Der Mensch lädt sie herunter und reviewt; wenn freigegeben, postet der Assistant die Spec als neues GitHub Issue mit Titel `SPEC-NNNN: <Title>`.

### 3. Implementierung (GitHub)

- Coding Agent liest das Issue und postet seinen Implementierungsplan als Issue-Kommentar.
- Plan-Diskussion im Chat. Der Assistant postet Refinement-Wünsche als Issue-Kommentare.
- Sobald der Plan steht, erstellt der Coding Agent einen Feature-Branch, implementiert und öffnet einen PR (PR im Issue verlinken).
- GitHub Actions läuft parallel als CI-Check.
- PR-Review im Chat. Der Assistant postet Kommentare am PR.
- Der Mensch merged manuell, wenn CI grün ist und das Review abgeschlossen.
- Issue wird mit dem Merge geschlossen.

### 4. Konzept-Dokument (optional)

Nach Merge kann der Assistant ein lightweight Konzept-Dokument als MD-Datei im Chat erstellen: Idee, Konzept, Grundzüge der Implementierung. Der Mensch lädt es herunter und packt es ggf. in die Projektdateien zur späteren Referenz.

### 5. RFC / Whitepaper (optional, später)

Wenn das Feature ausgereift und produktiv erprobt ist, kann ein vollständiges RFC erstellt werden: vollständige technische Beschreibung, rigorose Mathematik, Hintergründe und Trade-offs — eine Art Whitepaper. Auch dieses entsteht als MD-Datei im Chat und wird vom Menschen abgelegt.

## Coding-Spec-Konvention

Die folgenden Regeln gelten für alle Coding Specs (`SPEC-NNNN*.md`). Sie existieren, um zwei Failure-Modes zu vermeiden:

1. **Pseudo-Solidity in der Spec.** Ausgeschriebene Solidity-Snippets in der Spec sind eine Zwitter-Position: zu detailliert für Verhaltens-Beschreibung, zu wenig durchdacht für tatsächlichen Implementierungs-Code. Imports fehlen, Library-Annahmen sind unausgesprochen, Gas-Optimierungen sind nicht durchdacht. Der Coding Agent schreibt das ohnehin neu — die Spec leistet besser, wenn sie das Verhalten beschreibt, nicht den Code.

2. **Test-Bullet-Sweeps ohne Verbindlichkeit.** Eine Liste mit 70 "should test that..."-Bullets ist gleichzeitig zu viel (viele Bullets sind selbstverständliche Coding-Hygiene) und zu wenig (kein einzelner ist als "ohne den ist die Implementierung nicht spec-konform" markiert). Mandatory Tests müssen wenige, scharfe Verhaltens-Behauptungen sein.

### Stil

- **Verhalten in Prosa und Tabellen**, keine Solidity-Code-Blöcke. Storage-Slots als Tabelle (Typ, Setter, Mutability). Errors als Liste mit Selektor-Namen. State-Machine als Übergangstabelle oder ASCII-Diagramm.
- **Funktions-Signaturen okay als Referenz** (Parameter-Namen, Typen, Sichtbarkeit, Rückgabewerte), aber ohne Body. Pro Funktion ein Abschnitt mit Preconditions, Effects (in Prosa, nummeriert), Events, Reentrancy-Verhalten, Returns.
- **Pseudocode nur als Notnagel**, wenn Prosa wirklich unklar wäre. Höchstens ein- oder zweimal pro Spec.
- **Implementierungsfreiheit lassen.** Entscheidungen wie SafeERC20 vs. raw transfer, OpenZeppelin-Version, Storage-Packing, Gas-Optimierungen sind Coding-Agent-Domäne. Spec sagt was, nicht wie.

### Struktur

Verbindliche Top-Level-Sektionen einer Coding Spec, in dieser Reihenfolge:

1. **Header** — Datum, Status, Audience (typisch: `Coding agent (Claude Code)`), ggf. "replaces SPEC-NNNNx (rev DATE)"-Hinweis
2. **Summary** — Ein Absatz: was wird gebaut und warum
3. **Context** — Aktueller Zustand. Welches Problem löst das Feature? Bezug zu existierenden RFCs/SPECs
4. **Specification** — Der Hauptteil. Kann in mehrere durchnummerierte Unterabschnitte aufgeteilt werden (Architecture, Roles, Storage, State machine, Errors, Public interface, Funktions-Verhalten, Internal helpers, etc.)
5. **Mandatory Tests** — Eigener Top-Level-Abschnitt (siehe unten)
6. **Out of Scope** — Was dieses Feature explizit nicht abdeckt

### Mandatory Tests

Eigener Top-Level-Abschnitt am Ende der Spec, vor "Out of Scope". Format: kurze Sätze nach dem Muster

> MUST verify that `<observable>` <relation> after `<action>` [given `<precondition>`].

Beispiele:

- MUST verify that `unstakeBufferBase == B` after a successful full-close `settle()` from Case 1.
- MUST verify that `state == SETTLED` and `positionLiquidity() == 0` after a successful full-close `settle()` or full-close `swap()`.
- MUST verify that `swap()` reverts with `UseSettleInsteadOfSwap` when called in Case 1.
- MUST verify that `_afterStake` is invoked after `state` transitions to `STATE_STAKED`, with `liquidityDelta` equal to the freshly-minted liquidity.

Größenordnung: 20–40 Behauptungen pro Spec, abhängig von Komplexität.

Jede Behauptung muss SPEC-Verhalten betreffen, nicht Coding-Hygiene. Faustregel: Würde der Test failen, ist die Implementierung nicht spec-konform — aber nicht: würde der Test failen, hätte der Coding Agent eine schlechte Tag gehabt.

NICHT in die Mandatory Tests gehören:
- Edge-Case-Sweeps für Standard-Compiler-Verhalten (`require` reverts, etc.)
- Gas-Benchmarks
- Fuzzing-Targets (außer wenn ein bestimmtes Invariant explizit fuzz-getestet sein muss)
- Generic-Reentrancy-Probes (außer wenn die Spec ein spezifisches Reentrancy-Lock-Verhalten verlangt)

Solche Coverage darf der Coding Agent nach Bedarf ergänzen — gehört in den PR, nicht in die Spec.

## Templates

### Coding Spec (GitHub Issue)

```markdown
# SPEC-NNNN: <Title>

**Date:** YYYY-MM-DD
**Status:** ready for implementation
**Audience:** Coding agent (Claude Code)

## Summary
Ein Absatz: was wird gebaut und warum.

## Context
Aktueller Zustand. Welches Problem löst das Feature?
Bezug zu existierenden RFCs/SPECs.

## Specification
Der Hauptteil. Verhalten in Prosa und Tabellen. Keine Solidity-Code-Blöcke.
Funktions-Signaturen okay als Referenz, ohne Body.

Bei Bedarf in nummerierte Unterabschnitte aufteilen, z.B.:
1. Architecture
2. Roles
3. Storage
4. State machine
5. Errors
6. Public interface
7. Funktions-Verhalten (pro Funktion: Preconditions, Effects, Events, Returns)
8. Internal helpers
...

## Mandatory Tests
Liste von Verhaltens-Behauptungen, jede in der Form
"MUST verify that <observable> <relation> after <action>".

20–40 Behauptungen, abhängig von Komplexität. Jede muss SPEC-Verhalten
betreffen, nicht Coding-Hygiene.

## Out of Scope
Was dieses Feature explizit nicht abdeckt.
```

### Konzept-Dokument

```markdown
# <Feature Name>

## Idee
Kurz: was macht das Feature, welches Problem löst es.

## Konzept
Die zentralen Designentscheidungen und ihre Begründung.

## Implementierung (Grundzüge)
Wie wurde es gelöst — Komponenten, Schnittstellen, wichtige
Datenstrukturen. Architektur-Ebene, keine Code-Details.
```

### RFC / Whitepaper

Frei strukturiert, je nach Feature. Erwartete Inhalte: Motivation und Kontext, theoretische Grundlagen (inkl. Mathematik wo relevant), vollständige Spezifikation, Implementierungsdetails, Trade-offs, Referenzen.

## Arbeitsregeln

- **Chat ist Divergenz, Issue/Spec ist Konvergenz.** Konzeptarbeit bleibt im Chat. Erst wenn etwas tragfähig ist, wandert es als Spec ins Issue.
- **Der Assistant kommentiert, der Mensch merged.** Der Assistant hat keine `Contents: write`-Permission — Code-Commits und Merges sind nicht sein Job.
- **Issue-State ist binär.** Open = in Arbeit, closed = implementiert (oder verworfen). Keine Status-Labels.
- **Cross-References** zwischen Specs/RFCs verwenden die `SPEC-NNNN`/`RFC-NNNN`-Nummer, GitHub-Notation (`#42`) nur für GitHub-interne Links.
- **Spec-Konvention ist verbindlich.** Specs ohne Mandatory-Tests-Sektion oder mit Solidity-Code-Bodys werden im Chat-Review als unvollständig zurückgewiesen, bevor sie als Issue gepostet werden.
