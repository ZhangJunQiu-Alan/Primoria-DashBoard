# Primoria Dashboard — Claude Code Guide

## Response Style
- No preamble, no trailing summaries. Lead with the answer or action.
- Terse text. Use code, not prose, to explain code.
- No sycophantic openers. No "Great question!" or "Sure!".
- Prefer edits over full rewrites. Never rewrite a file just to add one function.
- Read a file once per conversation. Don't re-read unless it may have changed.

## Stack
- React 19 + TypeScript + Tailwind CSS 4 + Vite 8 (web app, deployed on Cloudflare Pages)
- Cloud sync: Supabase Auth + Postgres + Storage (optional; app works offline without it)
- State: Zustand 5 with `persist` middleware → localStorage
- Layout: `react-grid-layout` (responsive, 3 breakpoints: lg/md/sm)
- Icons: `lucide-react` | Toasts: `sonner`
- No shadcn, no Radix, no Framer Motion — custom CSS + Tailwind

## Project Structure
```
src/
  App.tsx                        # Top-level shell, top-bar controls, background
  index.css                      # Design tokens, widget-card, button utilities
  components/
    layout/
      Dashboard.tsx              # react-grid-layout wrapper
      WidgetShell.tsx            # Widget container (header, rename, remove)
      AddWidgetModal.tsx         # Widget catalog modal
      AIChatPanel.tsx            # Right sidebar AI chat
      TodoDndProvider.tsx        # Cross-widget DnD context
    widgets/                     # One file per widget type (11 widgets)
  store/
    dashboardStore.ts            # Layout, widget instances, names
    widgetDataStore.ts           # Per-widget data (todos, habits, links…)
    backgroundStore.ts           # Background image (base64)
    musicStore.ts                # Music library + per-widget current track
  types/widget.ts                # WidgetType union, LayoutItem, etc.
```

## Widget Types
`clock` `quick-links` `motto` `notes` `lined-notes` `todo` `pomodoro`
`google-calendar` `music-player` `habits` `scheduled-todo`

To add a new widget: update `WidgetType` (types/widget.ts) → add default size to `dashboardStore.ts` (VALID_TYPES + DEFAULT_SIZES) → create component in `widgets/` → register in `WidgetShell.tsx` (switch + DEFAULT_TITLES) → add to `AddWidgetModal.tsx`.

## Design Tokens (index.css :root)
```
Backgrounds:  --bg #F7F3EC  --bg-card #FEFAF5  --bg-muted #EDE7DA
              --bg-hover #EFF6F0  --bg-hover-dark #E2EEE3  --bg-icon #EAF4EB
Primary:      --primary #7A9E7E  --primary-light #A8C5AC  --primary-dark #5C7D60
Accent:       --secondary #C4956A  --accent #D4B896
Text:         --text #3D342A  --text-sub #6B5D52  --text-muted #9B8E85
Structure:    --border #DDD3C3  --shadow rgba(90,70,50,0.09)  --shadow-md rgba(90,70,50,0.14)
Radius:       --r-sm 10px  --r-md 16px  --r-lg 22px
```
Never hardcode hex colors that match a token. Use the CSS variable.

## CSS Utility Classes
```
.widget-card          # base card (bg-card, border, r-lg, box-shadow)
.widget-transparent   # removes bg/border/shadow (used by clock)
.widget-content       # position:relative z-index:1
.btn-ghost-hover      # hover → green tint + primary-light border (!important)
.btn-lift             # hover → translateY(-1px)
.btn-danger-hover     # hover → red/pink color
.btn-icon-hover       # hover → bg-muted background
.widget-item          # hover → bg-hover + primary-light border (AddWidgetModal cards)
```
Use CSS classes for hover states. Do NOT use `onMouseEnter`/`onMouseLeave`.

## Typography
- Headers/titles: `font-family: 'Cormorant Garamond', serif` — 12px, 600, uppercase, tracking 0.14em
- Body: `font-family: 'DM Sans', sans-serif` — 13–14px

## Zustand Patterns
- Selectors that may return undefined must use a **module-level stable constant** as fallback (not `?? []` inline) — React 19 `useSyncExternalStore` treats new array refs as changed → infinite loop.
  ```tsx
  const EMPTY: Item[] = []   // at module scope
  const items = useStore(s => s.itemsByWidget[widgetId] ?? EMPTY)
  ```
- Actions are stable function refs — safe to select directly.

## Key Conventions
- Hover: CSS classes only, no JS event handlers for style changes
- Styling: CSS variables for colors; Tailwind for layout/spacing; inline `style={{}}` only for dynamic values
- Popover/floating UI: use `position: fixed` + `getBoundingClientRect()` to escape `overflow:hidden` on `.widget-card`
- Widget content padding: `p-3` (12px) via WidgetShell
- Grid row height: 80px | margin: 12px | container padding: 16px
