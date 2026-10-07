/* The Help page: the jobs people do most, each in a few plain steps, in the words the screens use (bill, order, hold, send to kitchen). */
export type Task = { id: string; title: string; icon: string; steps: string[]; go?: string; goLabel?: string };

export const guide = (food: boolean): Task[] => {
  const common: Task[] = [
    { id: 'bill', title: 'Make a bill', icon: 'cart-outline', go: '/sell', goLabel: 'Go to Sell', steps: ['Open Sell.', food ? 'Tap the items on the menu. A drink with choices asks for size or milk first.' : 'Tap an item, or scan its barcode with Scan.', 'Check the bill with the Bill button. Use + and − to change a quantity.', 'Tap Take payment, choose Cash, UPI or Card, then confirm.', 'Hand over the bill: Print or Share it, then tap New bill.'] },
    { id: 'offline', title: 'Keep billing when the internet is off', icon: 'cloud-offline-outline', steps: ['Just carry on. Make bills as usual.', 'The line at the top says how many bills are waiting to send.', 'When the signal is back they are sent by themselves, once each, in order.', 'A bill FlowXP cannot accept stays in Bills with the reason, for you to decide.'] },
    { id: 'hold', title: 'Hold a bill for later', icon: 'pause-circle-outline', go: '/held', goLabel: 'See held bills', steps: ['On Sell, tap Hold and give it a name, like "Ravi" or "blue shirt".', 'The till is clear for the next customer.', 'To carry on: More, then Bills on hold, then Resume.'] },
    { id: 'price', title: 'Change a price', icon: 'pricetag-outline', go: '/products', goLabel: 'Go to Products', steps: ['Open Products and tap the item.', 'Type the new price under Change the price.', 'Tap Save price. New bills use it straight away.'] },
    { id: 'stock', title: 'Fix a stock count', icon: 'layers-outline', go: '/stock', goLabel: 'Go to Stock', steps: ['Open More, then Stock, and tap the item.', 'Type how many to add, or a minus number to take away.', 'Say why (counted, damaged, received) and tap Update stock.'] },
    { id: 'customer', title: 'Put a customer on a bill', icon: 'person-add-outline', go: '/customers', goLabel: 'Go to Customers', steps: ['On Sell, tap Add customer.', 'Search by name or phone, or tap Add customer for a new one.', 'Their bill is saved under their name, and they earn their visit card stamp.'] },
    { id: 'print', title: 'Print a receipt', icon: 'print-outline', go: '/settings', goLabel: 'Printer settings', steps: ['Open More, then Settings, and choose 58 mm or 80 mm paper.', 'Tap Print a test receipt to check it lines up.', 'After any bill, tap Print.'] }
  ];
  const foodTasks: Task[] = [
    { id: 'table', title: 'Take an order at a table', icon: 'restaurant-outline', go: '/tables', goLabel: 'Go to Tables', steps: ['Open Tables and tap a free table.', 'Tap Add items, then tap what the guests want.', 'Tap Send to kitchen. The cooks see it at once.', 'When the food is ready, tap Mark served.', 'When the table is done, tap Bill and pay.'] },
    { id: 'kitchen', title: 'Use the kitchen screen', icon: 'flame-outline', go: '/kitchen', goLabel: 'Open the kitchen screen', steps: ['Open More, then Kitchen screen. Leave it open: it stays awake and refreshes itself.', 'Tap a dish when it is done, or All ready for the whole ticket.', 'Rush puts a table first. Undo is on the bar for a few seconds.', 'The phone buzzes for a new order, and for a dish that is late.'] }
  ];
  return food ? [common[0], foodTasks[0], foodTasks[1], ...common.slice(1)] : common;
};
