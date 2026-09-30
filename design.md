# FlowXP --- Master Design System & Frontend Design Specification

**File:** `design.md`\
**Product:** FlowXP\
**Company:** ManagerXP\
**Purpose:** Master design and frontend specification for Cloud Code /
Claude Code and human frontend engineers\
**Status:** Active --- redesign baseline

------------------------------------------------------------------------

# 1. Executive Design Direction

FlowXP must be redesigned as a **premium, production-grade business
operating system**, not as a generic AI SaaS template.

The current UI has a clean technical foundation, but the visual language
is too close to a common AI-generated SaaS landing page:

-   oversized centered hero
-   floating pill navigation
-   blue/cyan gradients
-   decorative floating elements
-   excessive rounded containers
-   generic dashboard mockup
-   large empty whitespace
-   "AI-powered" messaging as a visual shortcut

The new FlowXP design must feel **intentional, calm, highly polished,
useful and commercially credible**.

### Core statement

> **FlowXP should look like a product designed by a world-class product
> designer and implemented by a senior frontend engineer --- not like a
> collection of AI-generated UI components.**

The product should communicate:

**clarity → speed → trust → control → intelligence**

------------------------------------------------------------------------

# 2. Design North Star

Use the quality bar of products such as:

-   ChatGPT
-   Linear
-   Stripe
-   Shopify
-   Vercel
-   Notion
-   modern professional POS systems

These are references for:

-   hierarchy
-   spacing
-   interaction quality
-   typography
-   restraint
-   information architecture
-   product storytelling

They are NOT visual templates to copy.

### Important

Do not copy another product's:

-   exact layout
-   branding
-   colors
-   illustrations
-   components
-   navigation
-   copy
-   visual identity

Use them only to understand the level of product craftsmanship expected.

------------------------------------------------------------------------

# 3. Design References

The design process may use:

### 21st.dev

Use 21st.dev as a source of high-quality React component ideas and
implementation patterns.

Use it selectively.

Do NOT build FlowXP by assembling unrelated 21st.dev components.

Every component must be adapted to the FlowXP design system.

### NavGallery

Use NavGallery-style inspiration for:

-   navigation quality
-   polished interaction patterns
-   responsive navigation
-   subtle transitions
-   visual hierarchy

Again, inspiration only.

### Designer skills

Cloud Code should use the available designer/frontend skills when
possible, especially:

-   UI design
-   design systems
-   interaction design
-   visual critique
-   UX strategy
-   frontend implementation
-   accessibility
-   responsive design

The final authority is always this `design.md`.

------------------------------------------------------------------------

# 4. Product Identity

FlowXP is not primarily an "AI product".

FlowXP is:

> **A business operating system for billing, payments, inventory,
> restaurant operations, GST, customers, staff and business
> intelligence.**

AI is an intelligent layer on top of the operational system.

Therefore:

### Do

-   show operational value
-   show real business workflows
-   show real product interfaces
-   use AI where it provides useful insight
-   make the software feel dependable

### Do not

-   put "AI" everywhere
-   use purple AI gradients as the product identity
-   make the interface resemble an AI chatbot
-   add artificial AI badges
-   make AI the visual center of every screen

------------------------------------------------------------------------

# 5. Brand Personality

FlowXP should feel:

-   professional
-   confident
-   modern
-   fast
-   precise
-   warm
-   trustworthy
-   intelligent
-   operational

It should NOT feel:

-   childish
-   futuristic for the sake of futurism
-   crypto-like
-   gaming-like
-   overly corporate
-   template-generated
-   visually noisy

------------------------------------------------------------------------

# 6. Visual Concept

The new visual direction is:

## Warm Professional SaaS

Use:

-   warm white / neutral backgrounds
-   deep navy/charcoal typography
-   controlled FlowXP red
-   subtle neutral borders
-   restrained shadows
-   carefully selected imagery
-   product screenshots as visual proof
-   strong typography
-   asymmetrical layouts where appropriate
-   generous but purposeful whitespace

### Primary brand accent

FlowXP red should be the primary action color.

Use red for:

-   primary CTA
-   active navigation
-   important actions
-   selected states
-   important status
-   product highlights

Do not make the entire interface red.

------------------------------------------------------------------------

# 7. Color Tokens

Create tokens rather than scattered colors.

Suggested foundation:

``` css
--background: #FAFAF8;
--surface: #FFFFFF;
--surface-subtle: #F5F5F2;

--text-primary: #111827;
--text-secondary: #667085;
--text-muted: #98A2B3;

--border: #E5E7EB;
--border-strong: #D0D5DD;

--brand: #D92D20;
--brand-hover: #B42318;
--brand-soft: #FEF3F2;

--success: #12B76A;
--warning: #F79009;
--danger: #D92D20;
--info: #1570EF;
```

These are starting tokens, not immutable values.

The final values must be centralized in the design system.

------------------------------------------------------------------------

# 8. Dark Mode

Dark mode should be supported by the design system even if it is not the
immediate priority.

Dark mode must NOT simply invert colors.

Define dedicated dark tokens.

Example:

``` text
dark background
dark surface
dark elevated surface
dark border
dark primary text
dark secondary text
brand red
semantic colors
```

Avoid pure black unless a specific screen benefits from it.

------------------------------------------------------------------------

# 9. Typography

Use one professional sans-serif family.

Preferred candidates:

1.  Inter
2.  Geist
3.  IBM Plex Sans

Choose one consistently.

### Typography principles

Large text should be:

-   strong
-   compact
-   readable
-   intentional

Avoid giant headings that exist only to create visual drama.

### Suggested hierarchy

``` text
Display       56–72px
H1            44–56px
H2            32–40px
H3            24–30px
H4            18–22px
Body          15–17px
Small         13–14px
Caption       11–12px
```

Adjust based on screen size.

------------------------------------------------------------------------

# 10. Font Weight

Use weight intentionally.

Recommended:

``` text
400 Regular
500 Medium
600 Semibold
700 Bold
```

Do not use 700 everywhere.

Body content should normally remain regular.

------------------------------------------------------------------------

# 11. Spacing System

Use an 8-point spacing system with 4px where necessary.

``` text
4
8
12
16
20
24
32
40
48
64
80
96
120
```

Spacing must establish hierarchy.

Do not add random padding to make a page appear "premium".

------------------------------------------------------------------------

# 12. Border Radius

Avoid the "everything is a pill" problem.

Use:

``` text
Inputs:       8px
Buttons:      8px
Cards:        12px
Panels:       12–16px
Dialogs:      16px
Pills:        reserved for status/tags
```

Buttons should normally NOT be pill-shaped.

------------------------------------------------------------------------

# 13. Shadows

Use subtle elevation.

Preferred:

-   small shadow for dropdowns
-   medium shadow for dialogs
-   subtle shadow for floating navigation
-   little/no shadow for normal content sections

Do not put a shadow on every card.

Borders are often better than shadows for business software.

------------------------------------------------------------------------

# 14. Icons

Use one icon system.

Preferred:

-   Lucide

Rules:

-   consistent stroke width
-   consistent sizing
-   icons support meaning
-   icons do not replace unclear labels
-   do not mix icon libraries

------------------------------------------------------------------------

# 15. Marketing Website

The marketing website should feel like a serious software company.

## New hero direction

Do NOT use the current:

``` text
small badge
huge centered headline
gradient word
two pill buttons
decorative confetti
generic dashboard
```

Instead use a more editorial/product-led composition.

### Preferred structure

``` text
------------------------------------------------
Navigation
------------------------------------------------

Small eyebrow:
RESTAURANT & RETAIL BUSINESS OPERATING SYSTEM

Large headline:
Run your business
with less friction.

Supporting text

[Start 7-day free trial] [Watch demo]

Trust points

                         Product interface
                         large realistic
                         FlowXP screenshot

------------------------------------------------
Core capability strip
------------------------------------------------
Billing | Inventory | Orders | GST | AI
------------------------------------------------
```

The hero should visually demonstrate the product.

------------------------------------------------------------------------

# 16. Hero Typography

Prefer:

``` text
Run your restaurant
smarter with FlowXP.
```

over generic:

``` text
The smart flow
for every business.
```

The headline should communicate:

-   who the product is for
-   what it does
-   why it matters

Do not overuse marketing buzzwords.

------------------------------------------------------------------------

# 17. Product Screenshots

Product screenshots are a major part of the visual identity.

Use real FlowXP interfaces wherever possible.

Screenshots should show:

-   actual navigation
-   actual tables
-   actual POS
-   actual orders
-   actual data
-   realistic values
-   real interaction patterns

Do not use fake futuristic dashboard graphics.

### Screenshot treatment

Use:

-   subtle frame
-   realistic browser/device context when useful
-   controlled shadow
-   slight perspective only if it improves presentation

Avoid huge 3D mockups.

------------------------------------------------------------------------

# 18. Website Section Rhythm

The marketing website should alternate visual density.

Example:

``` text
Hero
↓
Capability strip
↓
Product story
↓
Workflow explanation
↓
Feature showcase
↓
Restaurant use cases
↓
Analytics / AI
↓
Integrations
↓
Pricing
↓
Final CTA
↓
Footer
```

Do not make every section look identical.

------------------------------------------------------------------------

# 19. Product Storytelling

Every major marketing section should answer one question.

Examples:

### POS

How quickly can I take an order and collect payment?

### Inventory

How do I know what is running low?

### Restaurant

How do I manage dine-in, takeaway and delivery?

### Reports

How do I understand my business?

### AI Manager

What should I pay attention to?

Avoid generic feature lists.

------------------------------------------------------------------------

# 20. Application Shell

The application should feel substantially different from the marketing
website.

Marketing:

-   expressive
-   editorial
-   visual
-   spacious

Application:

-   focused
-   dense
-   operational
-   fast

Do not use the marketing hero visual language inside the application.

------------------------------------------------------------------------

# 21. Application Layout

Desktop:

``` text
┌─────────────────────────────────────────────────────────┐
│ Business / Branch    Search       Notifications Profile │
├───────────────┬─────────────────────────────────────────┤
│               │                                         │
│ FlowXP        │ Page Header                             │
│               │                                         │
│ Dashboard     │ Main content                            │
│ POS           │                                         │
│ Orders        │                                         │
│ Products      │                                         │
│ Inventory     │                                         │
│ Customers     │                                         │
│ Suppliers     │                                         │
│ Reports       │                                         │
│ Restaurant    │                                         │
│ AI Manager    │                                         │
│ Settings      │                                         │
│               │                                         │
└───────────────┴─────────────────────────────────────────┘
```

------------------------------------------------------------------------

# 22. Sidebar

Sidebar should be compact and purposeful.

Suggested grouping:

### Overview

Dashboard

### Sell

POS\
Orders\
Invoices

### Manage

Products\
Inventory\
Purchases\
Customers\
Suppliers

### Restaurant

Tables\
KOT / Kitchen\
QR Orders

### Business

Expenses\
GST\
Reports

### Intelligence

AI Manager

### System

Settings

Do not expose every backend module as a navigation item.

------------------------------------------------------------------------

# 23. Sidebar Interaction

Support:

-   active state
-   collapsed mode
-   tooltip in collapsed mode
-   keyboard navigation
-   clear group hierarchy
-   current branch/business context

The active item should be obvious without being visually loud.

------------------------------------------------------------------------

# 24. Top Bar

Top bar should contain:

-   business selector
-   branch selector
-   global search
-   notifications
-   help where useful
-   profile

Do not fill the top bar with decorative elements.

------------------------------------------------------------------------

# 25. Global Search

FlowXP should eventually have a command/search experience.

Possible search:

``` text
Search products
Search customers
Search invoices
Search orders
Go to POS
Go to Inventory
Go to Reports
```

Keyboard shortcut:

``` text
⌘ K
Ctrl K
```

Use this for power users.

------------------------------------------------------------------------

# 26. Dashboard

The dashboard is an operational command center.

It should answer:

1.  What happened?
2.  What is happening?
3.  What needs attention?
4.  What should I do next?

### Recommended structure

``` text
Good morning, [Business]

Today / Date / Branch controls

Revenue       Orders       Avg Order       Outstanding

Revenue trend

Live orders / operational activity

Low stock / attention required

Top products

Recent activity
```

Avoid a dashboard composed entirely of statistic cards.

------------------------------------------------------------------------

# 27. Dashboard KPI Design

Each KPI needs context.

Example:

``` text
TODAY'S SALES

₹48,250

↑ 12.4% from yesterday
```

Use trends only when they are meaningful.

Do not put charts inside every KPI.

------------------------------------------------------------------------

# 28. POS Design

POS is a critical workflow.

The interface must optimize for speed.

Recommended:

``` text
┌─────────────────────────────────────────────────────┐
│ Search / Barcode                         Customer   │
├───────────────────────────┬─────────────────────────┤
│ Categories                │ Current Order           │
│                           │                         │
│ Product grid              │ Items                   │
│                           │                         │
│                           │ Discounts               │
│                           │ Tax                     │
│                           │ Total                   │
│                           │                         │
│                           │ [PAY]                   │
└───────────────────────────┴─────────────────────────┘
```

### POS must support

-   search
-   barcode
-   category filtering
-   modifiers
-   quantity
-   discounts
-   customer
-   hold/resume
-   split bill
-   partial payment
-   multiple payment methods
-   receipt
-   keyboard shortcuts

Avoid decorative animation.

------------------------------------------------------------------------

# 29. Restaurant POS

Restaurant POS must support:

-   dine-in
-   takeaway
-   delivery
-   tables
-   KOT
-   modifiers
-   notes
-   customer
-   split bill

Order type must be immediately visible.

------------------------------------------------------------------------

# 30. Restaurant Tables

Table interface should be spatially understandable.

Each table should show:

-   table number
-   occupied/free
-   order state
-   elapsed time
-   amount where useful

Use status color + text.

Never rely on color alone.

------------------------------------------------------------------------

# 31. KOT / Kitchen

Kitchen UI is an operational screen.

Prioritize:

1.  order number
2.  elapsed time
3.  items
4.  modifiers
5.  table/order type
6.  action

Cards should be readable from a distance.

Do not overdecorate kitchen screens.

------------------------------------------------------------------------

# 32. Orders

Order list should support:

-   search
-   date
-   branch
-   order type
-   status
-   payment status
-   customer
-   amount

Use a dense table on desktop.

Use cards or horizontal rows on mobile.

------------------------------------------------------------------------

# 33. Inventory

Inventory should prioritize exceptions.

Important:

-   low stock
-   out of stock
-   stock movement
-   purchase
-   adjustment
-   current stock
-   threshold

The interface should make problems easy to find.

------------------------------------------------------------------------

# 34. Products

Product management should be efficient.

Support:

-   search
-   category
-   SKU
-   barcode
-   tax
-   pricing
-   stock
-   status

Product creation should use logical sections rather than a huge wall of
inputs.

------------------------------------------------------------------------

# 35. Customers

Customer list should make customer history accessible.

Useful:

-   contact
-   order count
-   total spent
-   outstanding
-   last order
-   loyalty where enabled

Use detail drawers where a full page is unnecessary.

------------------------------------------------------------------------

# 36. Reports

Reports must be data-first.

Every report should have:

-   date filter
-   branch filter
-   relevant filters
-   summary
-   chart where useful
-   detailed table
-   export

Do not use charts as decoration.

------------------------------------------------------------------------

# 37. AI Manager

AI Manager is an intelligence layer.

It should not look like ChatGPT pasted into FlowXP.

Preferred:

``` text
Business insights

Revenue increased 12% this week.

3 products generated 41% of sales.

5 inventory items are approaching
their reorder threshold.

Recommended actions

[Review inventory]
[View top products]
[Open sales report]
```

AI outputs should contain:

-   insight
-   supporting data
-   reason
-   action

Avoid unsupported claims.

------------------------------------------------------------------------

# 38. Forms

Forms must be practical.

Rules:

-   clear labels
-   useful defaults
-   minimal required fields
-   inline validation
-   logical sections
-   progressive disclosure
-   preserve entered data
-   clear save/cancel actions

Do not hide critical business fields.

------------------------------------------------------------------------

# 39. Tables

Tables are a core FlowXP pattern.

Support where relevant:

-   search
-   sorting
-   filtering
-   pagination
-   bulk actions
-   column visibility
-   row actions

Default density should be compact.

------------------------------------------------------------------------

# 40. Cards

Cards are allowed, but must have purpose.

Good:

-   summary
-   status
-   focused workflow
-   grouped information

Bad:

``` text
Card
Card
Card
Card
Card
Card
```

If a table communicates the information better, use a table.

------------------------------------------------------------------------

# 41. Drawers

Use drawers for:

-   quick details
-   quick edit
-   contextual information
-   secondary workflows

Example:

Click an order → order detail drawer.

Do not turn every interaction into a modal.

------------------------------------------------------------------------

# 42. Modals

Use modals for:

-   confirmation
-   short focused forms
-   destructive actions
-   payment confirmation
-   critical decisions

Avoid multi-step application workflows inside modal windows.

------------------------------------------------------------------------

# 43. Empty States

Every major screen needs a useful empty state.

Example:

``` text
No products yet

Add your first product to start billing
and tracking inventory.

[Add Product]
```

Avoid meaningless illustrations.

------------------------------------------------------------------------

# 44. Loading States

Use:

-   skeletons for content
-   inline loading for actions
-   optimistic updates where safe
-   disabled action state during submission

Do not freeze the whole interface for a small request.

------------------------------------------------------------------------

# 45. Error States

Errors must explain the problem.

Bad:

``` text
Something went wrong.
```

Good:

``` text
Product could not be saved.

SKU PR-104 already exists.
Choose another SKU and try again.

[Edit SKU]
```

------------------------------------------------------------------------

# 46. Toasts

Use toasts for:

-   saved
-   updated
-   deleted
-   copied
-   sync completed

Do not use toasts for critical errors that require user action.

------------------------------------------------------------------------

# 47. Animation

Animation must communicate:

-   transition
-   hierarchy
-   feedback
-   continuity

Recommended UI transition:

``` text
120–220ms
```

Use GSAP/Motion selectively.

### Good

-   page entrance
-   drawer
-   modal
-   navigation
-   hover feedback
-   onboarding
-   marketing interactions

### Bad

-   constant floating elements
-   excessive parallax
-   animated backgrounds
-   animated KPI numbers everywhere
-   slow page transitions
-   animation during checkout

------------------------------------------------------------------------

# 48. Marketing Motion

The marketing website can be more expressive than the application.

Use subtle:

-   reveal animations
-   product screenshot movement
-   section transitions
-   hover interactions
-   scroll-linked storytelling

Do not create a motion showcase.

------------------------------------------------------------------------

# 49. Responsive Design

Desktop is the primary business workspace.

Tablet must be fully usable.

Mobile web should support essential workflows.

Do NOT simply shrink desktop.

### Mobile behavior

Navigation:

``` text
desktop sidebar
→
mobile bottom/navigation drawer
```

Tables:

``` text
desktop table
→
mobile information rows/cards
```

Forms:

``` text
multi-column
→
single-column
```

Actions:

``` text
desktop inline
→
mobile sticky/contextual
```

------------------------------------------------------------------------

# 50. Accessibility

Required:

-   semantic HTML
-   keyboard navigation
-   visible focus
-   proper labels
-   accessible dialogs
-   accessible tables
-   sufficient contrast
-   reduced motion
-   no color-only meaning

------------------------------------------------------------------------

# 51. Design Tokens

Centralize:

``` text
colors
typography
spacing
radius
shadows
breakpoints
z-index
transitions
```

Do not scatter arbitrary values throughout the application.

------------------------------------------------------------------------

# 52. Component System

Create a reusable FlowXP component system.

### Primitive components

``` text
Button
Input
Select
Combobox
DatePicker
Checkbox
Radio
Switch
Badge
Tooltip
Dropdown
Tabs
Dialog
Drawer
Toast
Table
Pagination
Skeleton
Breadcrumb
Command
Search
Filter
```

### Business components

``` text
BusinessSwitcher
BranchSwitcher
ProductSelector
CustomerSelector
Cart
PaymentPanel
OrderStatus
KOTCard
TableCard
InventoryStatus
StockMovement
InvoiceSummary
ReportFilter
AIInsight
```

------------------------------------------------------------------------

# 53. Component Quality

Before creating a component:

1.  Search existing FlowXP components.
2.  Reuse if the pattern already exists.
3.  Extend existing components if appropriate.
4.  Create a new component only when it has a meaningful boundary.

Do not create:

``` text
ProductCardV2
ProductCardNew
ProductCardFinal
ProductCardModern
```

because of small styling differences.

------------------------------------------------------------------------

# 54. Frontend Architecture

Current implementation is:

``` text
React 19
Vite 7
Tailwind CSS v4
React Router 7
GSAP
React Three Fiber / Three.js
```

Preserve the working application.

Do not perform a framework rewrite just for visual redesign.

Recommended organization:

``` text
frontend/
└── src/
    ├── app/
    ├── components/
    │   ├── ui/
    │   ├── layout/
    │   └── business/
    ├── features/
    │   ├── auth/
    │   ├── dashboard/
    │   ├── pos/
    │   ├── orders/
    │   ├── products/
    │   ├── inventory/
    │   ├── purchases/
    │   ├── customers/
    │   ├── suppliers/
    │   ├── restaurant/
    │   ├── reports/
    │   ├── ai/
    │   └── settings/
    ├── hooks/
    ├── services/
    ├── lib/
    ├── routes/
    └── styles/
```

------------------------------------------------------------------------

# 55. Existing Functionality Must Survive

The redesign must not break existing:

-   authentication
-   multi-tenancy
-   onboarding
-   business creation
-   branch management
-   products
-   categories
-   pricing
-   tax
-   HSN/SAC
-   SKU/barcode
-   stock
-   inventory ledger
-   customers
-   suppliers
-   invoices
-   payments
-   GST
-   purchases
-   expenses
-   reports
-   POS
-   dine-in
-   takeaway
-   delivery
-   tables
-   KOT
-   QR ordering
-   delivery integrations
-   RBAC
-   tenant isolation

Visual redesign is NOT permission to remove functionality.

------------------------------------------------------------------------

# 56. AI Coding Agent Workflow

Every design task must follow:

## Phase 1 --- Inspect

Before editing:

-   inspect current screen
-   inspect components
-   inspect routes
-   inspect API calls
-   inspect existing tokens
-   inspect related screens

## Phase 2 --- Design

Determine:

-   user
-   goal
-   primary action
-   information hierarchy
-   layout
-   responsive behavior
-   states

## Phase 3 --- Implement

Use existing architecture.

Reuse components.

Create tokens.

Avoid unnecessary dependencies.

## Phase 4 --- Visual Review

Check:

-   hierarchy
-   spacing
-   typography
-   alignment
-   density
-   contrast
-   consistency

## Phase 5 --- UX Review

Check:

-   loading
-   empty
-   error
-   success
-   permission
-   keyboard
-   mobile
-   tablet

## Phase 6 --- Regression

Confirm existing functionality still works.

------------------------------------------------------------------------

# 57. AI Agent Anti-Pattern Rules

The coding agent MUST NOT:

-   generate generic dashboard templates
-   copy 21st.dev pages wholesale
-   copy NavGallery designs
-   add gradients without purpose
-   use purple/cyan AI styling as the default
-   make every component rounded
-   make every component a card
-   add excessive shadows
-   create fake data
-   create fake functionality
-   introduce unnecessary libraries
-   rewrite the frontend architecture unnecessarily
-   remove existing functionality
-   replace real product screens with decorative mockups
-   add animation just because an animation library exists

------------------------------------------------------------------------

# 58. Real Data Rule

Production UI should use actual API data.

Do not hard-code:

``` text
₹48,250
128 orders
+12.4%
```

unless the data is explicitly a design mock.

For real implementation:

``` text
API → service → state → UI
```

------------------------------------------------------------------------

# 59. No Fake AI

Never fabricate AI insights.

Bad:

``` text
AI predicts revenue will increase 37%.
```

when no model/data supports this.

Good:

``` text
Sales are 18% higher than the previous
7-day period based on recorded orders.
```

AI features must distinguish:

-   observed data
-   calculated metrics
-   prediction
-   recommendation

------------------------------------------------------------------------

# 60. Marketing Copy Style

Use direct, confident language.

Prefer:

> Run your restaurant smarter.

over:

> Unlock the power of next-generation AI-driven business transformation.

Prefer:

> Billing, inventory and restaurant operations in one place.

over:

> Revolutionize your business ecosystem with intelligent automation.

The product should sound like a serious company.

------------------------------------------------------------------------

# 61. CTA Style

Primary CTA:

``` text
Start free trial
```

Secondary:

``` text
Watch demo
Explore features
See how it works
```

Avoid:

``` text
Experience the future
Unlock magic
Transform everything
```

------------------------------------------------------------------------

# 62. Landing Page Content Architecture

Recommended FlowXP website:

``` text
1. Navigation

2. Hero
   Product positioning
   CTA
   Real product screenshot

3. Capability strip
   Billing
   Inventory
   Orders
   GST
   AI

4. Product story
   Restaurant operations

5. How FlowXP works
   Setup
   Billing
   Operations
   Insights

6. Feature showcase
   POS
   Inventory
   Orders/KOT
   Reports
   AI

7. Restaurant workflows

8. Business intelligence

9. Integrations

10. Pricing

11. Trust / security / reliability

12. Final CTA

13. Footer
```

------------------------------------------------------------------------

# 63. Hero Reference Direction

The current screenshot should be redesigned toward this composition:

``` text
                 FLOWXP

     RESTAURANT & RETAIL OPERATING SYSTEM

     Run your restaurant
     smarter with FlowXP.

     Billing, payments, inventory, GST and
     restaurant operations in one platform.

     [ Start 7-day free trial ] [ Watch demo ]

     ✓ No credit card
     ✓ Quick setup
     ✓ Built by ManagerXP

                              ┌──────────────────────┐
                              │                      │
                              │ Real FlowXP product  │
                              │ dashboard            │
                              │                      │
                              └──────────────────────┘
```

The product screenshot should be visually important.

------------------------------------------------------------------------

# 64. Image Direction

Use authentic product and business imagery.

For restaurant marketing sections:

-   real restaurant environments
-   counters
-   POS terminals
-   staff workflows
-   food/service environment

Do not use obviously artificial futuristic imagery.

The software remains the hero.

------------------------------------------------------------------------

# 65. Product Screenshot Direction

FlowXP screenshots should have:

-   realistic data
-   realistic restaurant names
-   realistic Indian currency
-   realistic orders
-   meaningful statuses
-   actual FlowXP components

Example:

``` text
The Food Hub

Today's Sales     ₹24,580
Orders            86
Avg Order         ₹286
Tables Occupied   12/20
```

This makes the product understandable immediately.

------------------------------------------------------------------------

# 66. Visual Hierarchy Rule

On every screen there must be:

### Level 1

What is this page?

### Level 2

What matters now?

### Level 3

What can I do?

### Level 4

Supporting information

If everything looks equally important, the design has failed.

------------------------------------------------------------------------

# 67. Information Density Rule

Use density according to workflow.

### High density

-   POS
-   orders
-   inventory
-   reports
-   products

### Medium density

-   dashboard
-   customers
-   suppliers
-   purchases

### Low density

-   onboarding
-   setup
-   subscription
-   empty states
-   marketing pages

------------------------------------------------------------------------

# 68. Professionalism Test

Before accepting a design ask:

> Would a restaurant owner pay for this software?

> Would a cashier want to use this for 8 hours?

> Can a manager understand the screen in 5 seconds?

> Does it look like a real product or a generated concept?

> Is there anything on this screen that exists only to look impressive?

If the last answer is yes, remove it.

------------------------------------------------------------------------

# 69. Final Design Principle

FlowXP should not try to win through visual effects.

It should win through **product clarity**.

The final interface should feel:

> **Quietly premium. Extremely usable. Clearly FlowXP.**

The user should notice the quality without noticing the design tricks.

------------------------------------------------------------------------

# 70. Golden Rule

> **Do not design FlowXP to look impressive in a screenshot. Design it
> so that the screenshot is impressive because the product itself is
> exceptionally well designed.**
