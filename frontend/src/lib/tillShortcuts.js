/* The till's keyboard shortcuts, in one list: the popup shows it, and BillingPage's key handler does what each one says. F-keys (as in Tally) do the things a cashier reaches for most. */
import { T } from '../i18n/useT.js';

export const TILL_KEYS = [
  ['F1', T('Show these shortcuts')],
  ['F2', T('Choose the customer')],
  ['F3', T('Scan with the camera')],
  ['F4', T('Discount, coupon or note')],
  ['F5', T('Add a custom item')],
  ['F6', T('Hold this bill')],
  ['F7', T('Resume a held bill')],
  ['F8', T('Go to the amount received')],
  ['F9', T('Charge the bill')],
  ['F10', T('Clear the bill and start a new sale')],
  ['/', T('Search the items')],
  ['Ctrl + Enter', T('Charge the bill')],
  ['↑  ↓', T('Select a line on the bill')],
  ['+  −', T('One more or one less of the selected line')],
  ['Del', T('Remove the selected line')],
  ['Esc', T('Clear the search')]
];
