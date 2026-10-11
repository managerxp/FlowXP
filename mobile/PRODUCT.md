# FlowXP mobile app: product context

Read this before changing how the app looks or reads. It is the short answer to "who is this for and what must it feel like".

## Who uses it
Owners, cashiers, waiters and cooks in small Indian shops, supermarkets, cafés and restaurants, on a phone or a tablet at the counter, often standing, often busy, often with one hand free. Many are not comfortable with software and some read Hindi more easily than English. Some have never used a billing app.

## What they are doing
- A cashier makes a bill in seconds while a customer waits. Speed and never losing a sale matter more than anything else.
- A waiter or owner runs tables: open, add, send to the kitchen, serve, bill.
- A cook reads the kitchen screen from a distance and taps a dish when it is done.
- An owner glances at today's sales, what is low, and what is owed.

## Promises the product makes (never break these)
1. A bill is never made twice and never lost, with or without internet.
2. The total shown before payment is marked "about" (≈); the server's bill is the real one.
3. Nothing is deleted or discarded without saying exactly what will be lost.

## Voice
Plain words a shopkeeper uses: bill, item, customer, stock, table, kitchen. Short sentences. Say what happened and what to do next. Never "outbox", "sync", "catalogue", "SKU" or error codes. A bill is one transaction; "sales" is only the money total. A test (`test/learning.test.ts`) enforces this.

## Look and feel
Operate mode: the tool disappears into the task. One blue accent for actions, green for done, amber for waiting, red for trouble. Large targets (44 px at least, 52 to 56 in the kitchen), contrast at least 4.5:1, state shown in words as well as colour. Icons from one set (Ionicons). Phones get a bottom bar; tablets and wide screens get a left rail and two panes.

## Languages
English and Hindi, chosen on the sign-in screen or in Settings, remembered on the phone. A text without a Hindi version shows in English, never blank. New on-screen text goes into `src/lib/i18n.ts`; a test fails if a button or row has none.

## Not in the app (use the website)
Purchases and suppliers, expenses, returns and credit notes, GST returns, staff and roles, business settings, loyalty and coupon set-up, table moves and merges, reservations.
