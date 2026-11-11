# WhatsApp templates to create in Meta

Create each once in Meta Business Manager > WhatsApp > Message templates. Language: English. Name, variable order and wording must match exactly (the text below is generated from `modules/messaging/templates.js`). Category: Utility for service messages, Marketing for offers.

Already approved: `flowxp_bill`.

39 left to create, most needed first.

## 1. `flowxp_balance_due` (Utility) - BALANCE_DUE

```
Hi {{1}}, a gentle reminder from {{2}}: {{3}} is due on your account. Unpaid: {{4}}. Please pay when you can. Thank you!
```

Variables: {{1}} name (e.g. Rahul); {{2}} business (e.g. Sharma Stores); {{3}} amount (e.g. Rs. 1,250.00); {{4}} bills (e.g. INV-0041)

## 2. `flowxp_offer` (Marketing) - OFFER

```
Hi {{1}}, {{2}}: {{3}} Reply STOP to opt out.
```

Variables: {{1}} name (e.g. Rahul); {{2}} business (e.g. Sharma Stores); {{3}} offer (e.g. sample)

## 3. `flowxp_loyalty_next` (Marketing) - LOYALTY_NEXT

```
Hi {{1}}, your next visit to {{2}} earns a free {{3}}! Reply STOP to opt out.
```

Variables: {{1}} name (e.g. Rahul); {{2}} business (e.g. Sharma Stores); {{3}} reward (e.g. sample)

## 4. `flowxp_booking` (Utility) - RESERVATION

```
Hi {{1}}, your table at {{2}} is booked for {{3}}, party of {{4}}. See you soon!
```

Variables: {{1}} name (e.g. Rahul); {{2}} business (e.g. Sharma Stores); {{3}} when (e.g. 12 Nov, 6:30 pm); {{4}} party (e.g. 4)

## 5. `flowxp_booking_cancelled` (Utility) - RESERVATION_CANCELLED

```
Hi {{1}}, your booking at {{2}} for {{3}} has been cancelled.
```

Variables: {{1}} name (e.g. Rahul); {{2}} business (e.g. Sharma Stores); {{3}} when (e.g. 12 Nov, 6:30 pm)

## 6. `flowxp_waitlist_added` (Utility) - WAITLIST_ADDED

```
Hi {{1}}, you are on the waitlist at {{2}}. Estimated wait: about {{3}} minutes. We will message you when your table is ready.
```

Variables: {{1}} name (e.g. Rahul); {{2}} business (e.g. Sharma Stores); {{3}} minutes (e.g. 15)

## 7. `flowxp_table_ready` (Utility) - WAITLIST_READY

```
Hi {{1}}, your table at {{2}} is ready. Please come to the host desk.
```

Variables: {{1}} name (e.g. Rahul); {{2}} business (e.g. Sharma Stores)

## 8. `flowxp_ws_order_confirmed` (Utility) - WS_ORDER_CONFIRMED

```
Hi {{1}}, {{2}} has confirmed your order {{3}} ({{4}}). We will let you know when it is dispatched.
```

Variables: {{1}} name (e.g. Rahul); {{2}} business (e.g. Sharma Stores); {{3}} order (e.g. SO-0012); {{4}} total (e.g. Rs. 1,250.00)

## 9. `flowxp_ws_invoice` (Utility) - WS_INVOICE

```
Hi {{1}}, invoice {{3}} from {{2}} for {{4}} is due on {{5}}. View it here: {{6}} Thank you.
```

Variables: {{1}} name (e.g. Rahul); {{2}} business (e.g. Sharma Stores); {{3}} number (e.g. INV-0042); {{4}} total (e.g. Rs. 1,250.00); {{5}} due (e.g. sample); {{6}} link (e.g. sample)

## 10. `flowxp_ws_payment_received` (Utility) - WS_PAYMENT_RECEIVED

```
Hi {{1}}, {{2}} has received your payment of {{3}} (receipt {{4}}). Thank you!
```

Variables: {{1}} name (e.g. Rahul); {{2}} business (e.g. Sharma Stores); {{3}} amount (e.g. Rs. 1,250.00); {{4}} receipt (e.g. sample)

## 11. `flowxp_ws_payment_due` (Utility) - WS_PAYMENT_DUE

```
Hi {{1}}, a reminder from {{2}}: {{3}} on invoice {{4}} is due on {{5}}. Thank you!
```

Variables: {{1}} name (e.g. Rahul); {{2}} business (e.g. Sharma Stores); {{3}} amount (e.g. Rs. 1,250.00); {{4}} number (e.g. INV-0042); {{5}} due (e.g. sample)

## 12. `flowxp_ws_payment_overdue` (Utility) - WS_PAYMENT_OVERDUE

```
Hi {{1}}, {{3}} on invoice {{4}} to {{2}} is {{5}} days overdue. Please arrange payment at the earliest.
```

Variables: {{1}} name (e.g. Rahul); {{2}} business (e.g. Sharma Stores); {{3}} amount (e.g. Rs. 1,250.00); {{4}} number (e.g. INV-0042); {{5}} days (e.g. 30)

## 13. `flowxp_ws_order_dispatched` (Utility) - WS_ORDER_DISPATCHED

```
Hi {{1}}, your order {{3}} from {{2}} has been dispatched with invoice {{4}} on vehicle {{5}}. Thank you.
```

Variables: {{1}} name (e.g. Rahul); {{2}} business (e.g. Sharma Stores); {{3}} order (e.g. SO-0012); {{4}} invoice (e.g. sample); {{5}} vehicle (e.g. Swift KA01AB1234)

## 14. `flowxp_ws_delivery_update` (Utility) - WS_DELIVERY_UPDATE

```
Hi {{1}}, update on your order {{3}} from {{2}}: {{4}}. Thank you.
```

Variables: {{1}} name (e.g. Rahul); {{2}} business (e.g. Sharma Stores); {{3}} order (e.g. SO-0012); {{4}} status (e.g. Paid in full)

## 15. `flowxp_job_received` (Utility) - JOB_RECEIVED

```
Hi {{1}}, we have received your {{3}} at {{2}}. Job card {{4}}. Expected ready: {{5}}. We will keep you updated. Thank you.
```

Variables: {{1}} name (e.g. Rahul); {{2}} business (e.g. Sharma Stores); {{3}} vehicle (e.g. Swift KA01AB1234); {{4}} job_no (e.g. JC-0007); {{5}} when (e.g. 12 Nov, 6:30 pm)

## 16. `flowxp_job_estimate` (Utility) - JOB_ESTIMATE

```
Hi {{1}}, the estimate for your {{3}} at {{2}} (job card {{4}}) is {{5}} including GST. Please reply to approve the work. Thank you.
```

Variables: {{1}} name (e.g. Rahul); {{2}} business (e.g. Sharma Stores); {{3}} vehicle (e.g. Swift KA01AB1234); {{4}} job_no (e.g. JC-0007); {{5}} total (e.g. Rs. 1,250.00)

## 17. `flowxp_job_ready` (Utility) - JOB_READY

```
Hi {{1}}, your {{3}} is ready at {{2}} (job card {{4}}). You can collect it now. Thank you.
```

Variables: {{1}} name (e.g. Rahul); {{2}} business (e.g. Sharma Stores); {{3}} vehicle (e.g. Swift KA01AB1234); {{4}} job_no (e.g. JC-0007)

## 18. `flowxp_service_due` (Utility) - SERVICE_DUE

```
Hi {{1}}, your {{3}} is due for its next service on {{4}}. Call or visit {{2}} to book it. Thank you.
```

Variables: {{1}} name (e.g. Rahul); {{2}} business (e.g. Sharma Stores); {{3}} vehicle (e.g. Swift KA01AB1234); {{4}} date (e.g. 20 Nov)

## 19. `flowxp_salon_booked` (Utility) - SALON_APPT_BOOKED

```
Hi {{1}}, your appointment at {{2}} is booked for {{3}}: {{4}}. See you soon!
```

Variables: {{1}} name (e.g. Rahul); {{2}} business (e.g. Sharma Stores); {{3}} when (e.g. 12 Nov, 6:30 pm); {{4}} services (e.g. sample)

## 20. `flowxp_salon_reminder` (Utility) - SALON_APPT_REMINDER

```
Hi {{1}}, a reminder of your appointment at {{2}} on {{3}}: {{4}}. Reply if you need to change it.
```

Variables: {{1}} name (e.g. Rahul); {{2}} business (e.g. Sharma Stores); {{3}} when (e.g. 12 Nov, 6:30 pm); {{4}} services (e.g. sample)

## 21. `flowxp_salon_cancelled` (Utility) - SALON_APPT_CANCELLED

```
Hi {{1}}, your appointment at {{2}} on {{3}} has been cancelled. Call us to book another time.
```

Variables: {{1}} name (e.g. Rahul); {{2}} business (e.g. Sharma Stores); {{3}} when (e.g. 12 Nov, 6:30 pm)

## 22. `flowxp_salon_birthday` (Marketing) - SALON_BIRTHDAY

```
Happy birthday {{1}}! {{2}} has a treat for you: {{3}} Reply STOP to opt out.
```

Variables: {{1}} name (e.g. Rahul); {{2}} business (e.g. Sharma Stores); {{3}} offer (e.g. sample)

## 23. `flowxp_salon_anniversary` (Marketing) - SALON_ANNIVERSARY

```
Happy anniversary {{1}}! {{2}}: {{3}} Reply STOP to opt out.
```

Variables: {{1}} name (e.g. Rahul); {{2}} business (e.g. Sharma Stores); {{3}} offer (e.g. sample)

## 24. `flowxp_salon_member_expiry` (Utility) - SALON_MEMBER_EXPIRY

```
Hi {{1}}, your {{3}} membership at {{2}} ends on {{4}}. Renew at your next visit to keep your benefits.
```

Variables: {{1}} name (e.g. Rahul); {{2}} business (e.g. Sharma Stores); {{3}} plan (e.g. sample); {{4}} date (e.g. 20 Nov)

## 25. `flowxp_salon_points_expiry` (Utility) - SALON_POINTS_EXPIRY

```
Hi {{1}}, {{3}} of your reward points at {{2}} expire in the next {{4}} days. Use them on your next visit!
```

Variables: {{1}} name (e.g. Rahul); {{2}} business (e.g. Sharma Stores); {{3}} points (e.g. sample); {{4}} days (e.g. 30)

## 26. `flowxp_salon_revisit` (Marketing) - SALON_REVISIT

```
Hi {{1}}, it has been a while since your last visit to {{2}}. Book your next appointment with us! Reply STOP to opt out.
```

Variables: {{1}} name (e.g. Rahul); {{2}} business (e.g. Sharma Stores)

## 27. `flowxp_salon_inactive` (Marketing) - SALON_INACTIVE

```
Hi {{1}}, we miss you at {{2}}! {{3}} Reply STOP to opt out.
```

Variables: {{1}} name (e.g. Rahul); {{2}} business (e.g. Sharma Stores); {{3}} offer (e.g. sample)

## 28. `flowxp_salon_payment_due` (Utility) - SALON_PAYMENT_DUE

```
Hi {{1}}, a gentle reminder that {{4}} is still due on bill {{3}} at {{2}}. Thank you!
```

Variables: {{1}} name (e.g. Rahul); {{2}} business (e.g. Sharma Stores); {{3}} number (e.g. INV-0042); {{4}} amount (e.g. Rs. 1,250.00)

## 29. `flowxp_review_reply` (Utility) - REVIEW_REPLY

```
Hi {{1}}, {{2}}: {{3}} Thank you for your feedback.
```

Variables: {{1}} name (e.g. Rahul); {{2}} business (e.g. Sharma Stores); {{3}} reply (e.g. sample)

## 30. `flowxp_gym_otp` (Utility) - GYM_OTP

```
Your {{1}} sign-in code is {{2}}. It works for 10 minutes. Do not share it with anyone.
```

Variables: {{1}} business (e.g. Sharma Stores); {{2}} code (e.g. sample)

## 31. `flowxp_gym_welcome` (Utility) - GYM_WELCOME

```
Welcome to {{2}}, {{1}}! Your member code is {{3}}. We are glad to have you.
```

Variables: {{1}} name (e.g. Rahul); {{2}} business (e.g. Sharma Stores); {{3}} code (e.g. sample)

## 32. `flowxp_gym_subscribed` (Utility) - GYM_SUBSCRIBED

```
Hi {{1}},

Your membership at *_{{2}}_* is confirmed.

*Plan:* {{3}}
*Started on:* {{4}}
*Ends on:* {{5}}

Thank you for joining us. See you at the gym.
```

Variables: {{1}} name (e.g. Rahul); {{2}} business (e.g. Sharma Stores); {{3}} plan (e.g. sample); {{4}} start (e.g. sample); {{5}} end (e.g. sample)

## 33. `flowxp_gym_expiry` (Utility) - GYM_EXPIRY

```
Hi {{1}},

Your membership at *_{{2}}_* is ending soon.

*Plan:* {{3}}
*Ends on:* {{4}}

Renew at the desk to keep training without a break.

Thank you for training with us.
```

Variables: {{1}} name (e.g. Rahul); {{2}} business (e.g. Sharma Stores); {{3}} plan (e.g. sample); {{4}} date (e.g. 20 Nov)

## 34. `flowxp_gym_month_start` (Utility) - GYM_MONTH_START

```
Hi {{1}},

A new month begins at *_{{2}}_*. Here is your membership renewal.

*Plan:* {{3}}
*Ends on:* {{4}}
*Renewal amount:* {{5}}

Please renew at the desk to keep training without a break.

Thank you for training with us.
```

Variables: {{1}} name (e.g. Rahul); {{2}} business (e.g. Sharma Stores); {{3}} plan (e.g. sample); {{4}} date (e.g. 20 Nov); {{5}} amount (e.g. Rs. 1,250.00)

## 35. `flowxp_gym_expired` (Utility) - GYM_EXPIRED

```
Hi {{1}},

Your membership at *_{{2}}_* has ended.

*Plan:* {{3}}
*Ended on:* {{4}}

Renew at the desk whenever you are ready to come back.

We would be glad to see you again.
```

Variables: {{1}} name (e.g. Rahul); {{2}} business (e.g. Sharma Stores); {{3}} plan (e.g. sample); {{4}} date (e.g. 20 Nov)

## 36. `flowxp_gym_payment_due` (Utility) - GYM_PAYMENT_DUE

```
Hi {{1}},

This is a payment reminder from *_{{2}}_*.

*Plan:* {{3}}
*Amount due:* {{4}}

Please pay at the desk to keep your access.

Thank you for your support.
```

Variables: {{1}} name (e.g. Rahul); {{2}} business (e.g. Sharma Stores); {{3}} plan (e.g. sample); {{4}} amount (e.g. Rs. 1,250.00)

## 37. `flowxp_gym_class` (Utility) - GYM_CLASS

```
Hi {{1}}, a reminder: {{3}} at {{2}} on {{4}}. See you there.
```

Variables: {{1}} name (e.g. Rahul); {{2}} business (e.g. Sharma Stores); {{3}} class (e.g. sample); {{4}} when (e.g. 12 Nov, 6:30 pm)

## 38. `flowxp_gym_reward` (Utility) - GYM_REWARD

```
Hi {{1}}, you now have {{3}} reward points at {{2}}. Ask at the desk what they can get you.
```

Variables: {{1}} name (e.g. Rahul); {{2}} business (e.g. Sharma Stores); {{3}} points (e.g. sample)

## 39. `flowxp_gym_inactive` (Marketing) - GYM_INACTIVE

```
Hi {{1}}, we have not seen you at {{2}} for {{3}} days. We would love to have you back! Reply STOP to opt out.
```

Variables: {{1}} name (e.g. Rahul); {{2}} business (e.g. Sharma Stores); {{3}} days (e.g. 30)
