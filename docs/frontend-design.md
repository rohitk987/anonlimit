# AnonLimit frontend design

The current interface is an original AnonLimit design. It uses an Apple-inspired visual language—quiet system typography, generous space, restrained color, rounded surfaces, and direct product copy—to make a technical privacy protocol feel understandable. The brand mark, conceptual pass, page composition, copy, and interaction design are custom AnonLimit work; the project does not bundle Apple fonts, branding, images, or interface assets.

## Design intent

The page has two jobs. It first explains the product in plain language, then gives the visitor a working lab where every claim can be checked against live backend evidence. The visual hierarchy should feel calm and editorial while protocol state stays explicit and testable.

Five principles guide the interface:

1. **Lead with the promise.** “Limit the use. Leave the person unknown.” establishes the outcome before implementation details.
2. **Reveal complexity in sequence.** The hero, guided controls, browser wallet, verifier evidence, trace, records, invariants, audit, and assumptions move from concept to proof.
3. **Keep authority visible.** Browser-local slots explain holder state; backend panels separately identify the authoritative verifier and Action Simulator evidence.
4. **Say what happened.** Status text names acceptance, uncertainty, retry, receipt recovery, final failure, and rejection. Color supports that text but never replaces it.
5. **State the boundary.** The assumptions panel and footer keep the simulated-cryptography limitation in the primary experience.

## Page structure

| Region                 | Purpose                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------ |
| Global navigation      | Keeps AnonLimit identity and anchors to the Demo Lab, Evidence, and Assumptions sections.              |
| Hero                   | Introduces the bounded-use idea and links directly into the experiment and its limitations.            |
| Conceptual pass        | Turns the three-use allowance into a custom visual object built with HTML and CSS.                     |
| Guided experiment      | Presents the controls in the intended issue, use, retry, finish, and audit sequence.                   |
| Holder wallet          | Shows local IndexedDB state, remaining local slots, operation status, and the latest receipt.          |
| Evidence workspace     | Renders sanitized counts, safe events, masked records, invariant results, and linkability comparisons. |
| Assumptions and footer | Explain the simulated provider and the per-pass issuance boundary.                                     |

The primary implementation lives in [`apps/web/src/main.tsx`](../apps/web/src/main.tsx). Evidence-specific views live in [`apps/web/src/features/demo-lab/panels.tsx`](../apps/web/src/features/demo-lab/panels.tsx), and the visual system is defined in [`apps/web/src/style.css`](../apps/web/src/style.css).

## Visual foundations

The UI uses a small semantic palette taken directly from the stylesheet:

| Role                       | Value                 | Use                                                       |
| -------------------------- | --------------------- | --------------------------------------------------------- |
| Page surface               | `#f5f5f7`             | Hero background, subtle sections, quiet component fills.  |
| Primary ink                | `#1d1d1f`             | Main headings, body emphasis, conceptual pass surface.    |
| Secondary ink              | `#515154`             | Descriptions and supporting content.                      |
| Muted ink / dark secondary | `#6e6e73` / `#a1a1a6` | Labels, captions, metadata, and text on dark surfaces.    |
| Divider                    | `#d2d2d7`             | Panel borders and section rules.                          |
| Action blue                | `#0066cc`             | Primary actions, links, navigation focus, trace emphasis. |
| Success green              | `#248a3d` / `#34c759` | Passing results and completed wallet slots.               |
| Attention amber            | `#b25000` / `#ff9f0a` | Incomplete evidence and unknown or retry states.          |
| Rejection red              | `#d70015` / `#ff453a` | Destructive reset treatment and rejected protocol states. |

Typography uses the local system stack: `-apple-system`, BlinkMacSystemFont, `SF Pro Text`, `SF Pro Display`, `Helvetica Neue`, Arial, then `sans-serif`. These names select fonts already present on the visitor's device; the application downloads no font. Large headings use tight tracking and compact line height, while eyebrow labels use small uppercase text and wider tracking to organize dense evidence.

The content width is capped at 1200px. Major sections use generous vertical padding, panels use an 18px corner radius, and controls use a full pill radius. The conceptual pass and wallet introduce dark surfaces at the two moments where the visitor should think about the credential as a private object.

## Components and interaction

- **Brand mark:** a custom inline SVG keeps the identity crisp without an external asset request.
- **Conceptual pass:** a code-native illustration makes the three available slots visible without resembling a real credential.
- **Primary and secondary actions:** filled blue buttons advance the core flow; outlined pills handle supporting controls; the red outline reserves attention for reset.
- **Wallet slots:** numbered circles become green checkmarks as local slots complete. The accompanying text always reports the count.
- **Protocol state:** a bordered text strip is the canonical interaction status. Neutral, acceptance, unknown, retry, and rejection tones pair with explicit copy.
- **Evidence cards:** consistent white panels carry metrics, a safe event trace, masked records, invariant results, and the transient linkability audit.
- **Status results:** symbols and the words `PASS`, `FAIL`, `INCOMPLETE`, or `NOT_RUN` remain available when color cannot be perceived.

Buttons disable when their action would conflict with the current wallet state. An unresolved request blocks a new slot until the exact request is retried, and the fourth-use control becomes enabled only after all three local slots are complete. Demo-only controls disappear when demo mode is disabled.

## Responsive behavior

The interface supports a 320px minimum viewport and avoids page-level horizontal overflow. Evidence tables may scroll within their own wrapper.

- Above 1050px, the evidence metrics use six columns and the assumptions use four columns.
- At 1050px and below, metrics reduce to three columns and assumptions to two.
- At 760px and below, the hero actions stack, the control and wallet panels become one column, evidence panel pairs become one column, metrics and trace lanes use two columns, assumptions and the footer use one column, and the optional navigation note is hidden.

The end-to-end rehearsal checks both the desktop layout and a 390×844 viewport for horizontal overflow.

## Accessibility

Preserve these behaviors when changing the frontend:

- semantic landmarks, headings, ordered steps, tables, buttons, and links;
- the “Skip to demo controls” keyboard link;
- visible 3px focus outlines for interactive elements;
- keyboard activation of the main workflow;
- `aria-live` updates for operation and loading state;
- text labels alongside every state color;
- disabled states that follow the protocol state machine; and
- reduced-motion handling that removes smooth scrolling and effectively disables transitions.

Run `pnpm test:e2e` after changes to layout, control names, focus behavior, status copy, or responsive rules. Also test keyboard navigation and narrow layouts manually when introducing a new interactive component.

## Privacy-aware presentation

Frontend polish cannot weaken the protocol boundary. Keep credentials, opaque proofs, raw nullifiers, hidden slots, and exact retry bodies inside the browser wallet. Do not expose them in rendered evidence, URLs, analytics, logs, screenshots, or test attachments. Never present local slot counts as server truth; the evidence API and independent Action Simulator counts supply the authoritative result.

The UI must continue to call the cryptography simulated and avoid claiming production anonymity. The limit applies to one issued pass, while issuance policy determines who can receive another pass.

## Extending the design

Reuse the existing type scale, palette, radii, and spacing before adding a new visual primitive. New sections should have one clear purpose, use plain product language, and fit the concept-to-proof reading order. Favor HTML, CSS, and the established AnonLimit symbol system for small graphics so the public experience stays fast, inspectable, and visually coherent.

Before submitting a visible change, verify the desktop and narrow layouts, keyboard focus order, reduced-motion behavior, loading and failure states, long receipt or digest strings, and the complete guided scenario in the [getting-started guide](getting-started.md).
