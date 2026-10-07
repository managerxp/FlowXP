/*
 * Languages. The app is written in English; every shared component (buttons, titles, list rows, chips, hints) passes its text through t(),
 * which returns the Hindi when the person chose Hindi and the text is in the dictionary, and the English otherwise. So a missing translation
 * shows English, never a blank or a key. `{name}` in a text is filled from the second argument. The choice is remembered on the phone.
 */
import { createStore, useStore } from './store.ts';

export type Lang = 'en' | 'hi' | 'ta' | 'te' | 'kn' | 'mr' | 'bn' | 'gu';
/* Each language is written in itself. Only the ones with a dictionary below are translated; the others are offered now and show English
   until their words are added (add a dictionary to DICTS and set ready). */
export const LANGS: { id: Lang; label: string }[] = [
  { id: 'en', label: 'English' }, { id: 'hi', label: 'हिन्दी' }, { id: 'ta', label: 'தமிழ்' }, { id: 'te', label: 'తెలుగు' },
  { id: 'kn', label: 'ಕನ್ನಡ' }, { id: 'mr', label: 'मराठी' }, { id: 'bn', label: 'বাংলা' }, { id: 'gu', label: 'ગુજરાતી' }
];
export const isTranslated = (lang: Lang): boolean => lang === 'en' || lang in DICTS;

const store = createStore<{ lang: Lang }>({ lang: 'en' });
export const getLang = (): Lang => store.get().lang;
export const setLangValue = (lang: Lang) => store.set({ lang });
export const useLang = (): Lang => useStore(store).lang;

export const fill = (text: string, vars?: Record<string, string | number>): string => (vars ? text.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`)) : text);

export const t = (text: string, vars?: Record<string, string | number>): string => fill(DICTS[store.get().lang]?.[text] ?? text, vars);

/** Text that may be a plain string (translate it) or anything else (leave it). */
export const tx = <T,>(v: T): T => (typeof v === 'string' ? (t(v) as unknown as T) : v);

export const HI: Record<string, string> = {
  // tabs and places
  'Home': 'होम', 'Sell': 'बिक्री', 'Tables': 'टेबल', 'Bills': 'बिल', 'Products': 'प्रोडक्ट', 'More': 'और',
  'Customers': 'ग्राहक', 'Stock': 'स्टॉक', 'Reports': 'रिपोर्ट', 'Settings': 'सेटिंग्स', 'Help': 'मदद', 'Kitchen': 'किचन',
  'Kitchen screen': 'किचन स्क्रीन', 'Bills on hold': 'होल्ड पर बिल', 'Bills waiting to send': 'भेजने के इंतज़ार में बिल',
  // buttons
  'Back': 'पीछे', 'Cancel': 'रद्द करें', 'Done': 'हो गया', 'Next': 'आगे', 'Not now': 'अभी नहीं', 'Try again': 'फिर कोशिश करें', 'Got it': 'समझ गया',
  'Scan': 'स्कैन', 'Hold': 'होल्ड', 'Hold bill': 'बिल होल्ड करें', 'Clear bill': 'बिल साफ़ करें', 'Take payment': 'पेमेंट लें', 'New bill': 'नया बिल',
  'Resume': 'जारी रखें', 'Discard': 'हटाएँ', 'Rush': 'जल्दी', 'Mark served': 'परोसा गया', 'Add items': 'आइटम जोड़ें', 'Bill and pay': 'बिल बनाएँ और पेमेंट लें',
  'Add customer': 'ग्राहक जोड़ें', 'Add product': 'प्रोडक्ट जोड़ें', 'Save customer': 'ग्राहक सेव करें', 'Save product': 'प्रोडक्ट सेव करें', 'Save price': 'कीमत सेव करें',
  'Update stock': 'स्टॉक अपडेट करें', 'Remove this product': 'यह प्रोडक्ट हटाएँ', 'Start a bill': 'बिल शुरू करें', 'Call': 'कॉल करें', 'Send now': 'अभी भेजें',
  'Send waiting bills now': 'इंतज़ार वाले बिल अभी भेजें', 'Check for an update': 'अपडेट देखें', 'Print a test receipt': 'टेस्ट रसीद छापें', 'Print the bill': 'बिल छापें',
  'Share the bill': 'बिल शेयर करें', 'Sign out': 'साइन आउट', 'Allow the camera': 'कैमरा की अनुमति दें', 'Download now': 'अभी डाउनलोड करें', 'Takeaway order': 'टेकअवे ऑर्डर',
  'Back to the menu': 'मेन्यू पर वापस', 'Back to the bill': 'बिल पर वापस', 'Make my first bill': 'मेरा पहला बिल बनाएँ', 'Open flowxp.in': 'flowxp.in खोलें',
  'Watch the one-minute tour again': 'एक मिनट का टूर फिर देखें', 'Show the tips and checklist again': 'टिप्स और चेकलिस्ट फिर दिखाएँ', 'Next customer: new bill': 'अगला ग्राहक: नया बिल',
  "Clear this phone's data": 'इस फ़ोन का डेटा साफ़ करें', 'Send a test report to FlowXP': 'FlowXP को टेस्ट रिपोर्ट भेजें', 'Sign in': 'साइन इन', 'Continue': 'जारी रखें', 'Forgot your password?': 'पासवर्ड भूल गए?',
  'Show': 'दिखाएँ', 'Hide': 'छिपाएँ', 'Back to the tables': 'टेबल पर वापस', 'Cancel this item': 'यह आइटम रद्द करें', 'Send to the kitchen / barista': 'किचन / बरिस्ता को भेजें',
  // fields and placeholders
  'Search or scan a barcode': 'खोजें या बारकोड स्कैन करें', 'Search by name or barcode': 'नाम या बारकोड से खोजें', 'Search by name or phone': 'नाम या फ़ोन से खोजें',
  'Search the menu': 'मेन्यू में खोजें', 'Bill number, customer or phone': 'बिल नंबर, ग्राहक या फ़ोन', 'Name': 'नाम', 'Email': 'ईमेल', 'Email (optional)': 'ईमेल (वैकल्पिक)',
  'Password': 'पासवर्ड', 'Mobile number': 'मोबाइल नंबर', 'Selling price': 'बिक्री कीमत', 'MRP (optional)': 'MRP (वैकल्पिक)', 'Barcode': 'बारकोड', 'Barcode (optional)': 'बारकोड (वैकल्पिक)',
  '6-digit code': '6 अंकों का कोड', 'For example: Ravi': 'जैसे: रवि', 'Unit (pc, kg, litre)': 'इकाई (नग, किलो, लीटर)', 'How many (10 or -3)': 'कितने (10 या -3)',
  'How many do you have now?': 'अभी आपके पास कितने हैं?', 'Why (counted, damaged, received…)': 'क्यों (गिनती, खराब, प्राप्त…)', 'UPI reference (optional)': 'UPI रेफ़रेंस (वैकल्पिक)',
  'Slip or approval number (optional)': 'स्लिप या अप्रूवल नंबर (वैकल्पिक)', 'Cash received (optional)': 'मिली नकद राशि (वैकल्पिक)',
  // labels
  'Today': 'आज', "Today's sales": 'आज की बिक्री', 'Bills today': 'आज के बिल', 'Still to be paid': 'अभी चुकाना बाकी', 'Low on stock': 'स्टॉक कम', 'Still owed': 'बाकी रक़म',
  'Average bill': 'औसत बिल', 'Billed': 'कुल बिल', 'GST in it': 'इसमें GST', 'Best day': 'सबसे अच्छा दिन', 'Busiest hour': 'सबसे व्यस्त घंटा', 'Owes you': 'आपको देना है',
  'Bought so far': 'अब तक की ख़रीद', 'Last bill': 'आख़िरी बिल', 'Cost price': 'ख़रीद कीमत', 'In stock here': 'यहाँ स्टॉक में', 'Customer': 'ग्राहक', 'Business': 'व्यापार',
  'Outlet': 'आउटलेट', 'Server': 'सर्वर', 'App version': 'ऐप वर्ज़न', 'Phone code': 'फ़ोन कोड', 'Signed in as': 'साइन इन', 'Products on this phone': 'इस फ़ोन पर प्रोडक्ट',
  'Products last updated': 'प्रोडक्ट आख़िरी बार अपडेट', 'Bills waiting / need a decision': 'इंतज़ार में / फ़ैसला चाहिए', 'Late': 'देर', 'Oldest': 'सबसे पुराना', 'Ready': 'तैयार',
  'To make': 'बनाना है', 'Items': 'आइटम', 'Category': 'श्रेणी', 'GST rate': 'GST दर', 'Sales': 'बिक्री',
  // list rows
  'How much you sold, and what sells best': 'कितनी बिक्री हुई, और क्या सबसे ज़्यादा बिकता है', 'How to do things, and the quick tour': 'काम कैसे करें, और छोटा टूर',
  'Made without internet, and recent': 'बिना इंटरनेट के बने, और हाल के', 'Printer, updates, this phone': 'प्रिंटर, अपडेट, यह फ़ोन', 'Resume or discard': 'जारी रखें या हटाएँ',
  'The menu: prices, stock, add an item': 'मेन्यू: कीमत, स्टॉक, नया आइटम', 'Their bills, and what they still owe': 'उनके बिल, और कितना बाकी है',
  'What is running low, and fix a count': 'क्या कम है, और गिनती ठीक करें', 'What to make, what is ready to serve': 'क्या बनाना है, क्या परोसने को तैयार है', 'Switch outlet': 'आउटलेट बदलें',
  // section titles
  'Shop': 'दुकान', 'This phone': 'यह फ़ोन', 'Account': 'खाता', 'How do I…': 'मैं कैसे…', 'Learning the app': 'ऐप सीखें', 'Still stuck?': 'अभी भी अटके हैं?',
  'Best sellers': 'सबसे ज़्यादा बिकने वाले', 'Best sellers this week': 'इस हफ़्ते सबसे ज़्यादा बिके', 'Latest bills': 'ताज़ा बिल', 'Recent bills': 'हाल के बिल', 'How it was paid': 'भुगतान कैसे हुआ',
  'By category': 'श्रेणी के अनुसार', 'Day by day': 'दिन-दिन', 'Where the sales came from': 'बिक्री कहाँ से आई', 'Change the price': 'कीमत बदलें', 'Correct the stock': 'स्टॉक ठीक करें',
  'Takeaway and delivery, open now': 'टेकअवे और डिलीवरी, अभी खुले', 'New customer': 'नया ग्राहक', 'New product': 'नया प्रोडक्ट', 'Where are you billing?': 'आप कहाँ बिल बना रहे हैं?',
  'Updates by itself': 'अपने आप अपडेट होता है', 'Token to call out': 'बुलाने के लिए टोकन', 'Checking camera…': 'कैमरा जाँच रहे हैं…',
  // messages
  'No bills yet.': 'अभी कोई बिल नहीं।', 'No payments in this period.': 'इस अवधि में कोई भुगतान नहीं।', 'No sales in this period.': 'इस अवधि में कोई बिक्री नहीं।', 'No sales yet this week.': 'इस हफ़्ते अभी कोई बिक्री नहीं।',
  'No bills on hold. Hold one from the till when a customer steps away.': 'कोई बिल होल्ड पर नहीं है। ग्राहक के हटने पर बिक्री स्क्रीन से बिल होल्ड करें।',
  'No products on this phone yet. Connect once so they can be downloaded.': 'इस फ़ोन पर अभी प्रोडक्ट नहीं हैं। एक बार इंटरनेट से जुड़ें ताकि वे डाउनलोड हो सकें।',
  'Today\'s figures are shown to people allowed to see reports.': 'आज के आँकड़े केवल रिपोर्ट देखने की अनुमति वाले लोगों को दिखते हैं।',
  'Give it a name to find it later, like a person or a table.': 'बाद में ढूँढने के लिए नाम दें, जैसे किसी का नाम या टेबल।',
  'This bill is empty': 'यह बिल खाली है', 'Tap an item on the Menu, search above, or tap Scan to read a barcode.': 'मेन्यू में किसी आइटम पर टैप करें, ऊपर खोजें, या बारकोड पढ़ने के लिए स्कैन दबाएँ।',
  'Visit the FlowXP website for guides and to contact us.': 'गाइड और संपर्क के लिए FlowXP वेबसाइट देखें।',
  'Done. The tips will appear again as you use each screen.': 'हो गया। हर स्क्रीन इस्तेमाल करते समय टिप्स फिर दिखेंगी।',
  'No internet. You can keep billing': 'इंटरनेट नहीं है। आप बिल बनाते रह सकते हैं', 'All bills sent': 'सारे बिल भेजे जा चुके हैं', 'FlowXP is not answering. You can keep billing': 'FlowXP जवाब नहीं दे रहा। आप बिल बनाते रह सकते हैं',
  'Sent': 'भेजा गया', 'FlowXP could not accept it': 'FlowXP ने इसे स्वीकार नहीं किया', 'Waiting to send': 'भेजने का इंतज़ार', 'Waiting for the internet.': 'इंटरनेट का इंतज़ार।',
  'Bill saved on this phone': 'बिल इस फ़ोन पर सेव हुआ', 'Bill made': 'बिल बन गया',
  'No internet. Check your connection and try again.': 'इंटरनेट नहीं है। कनेक्शन जाँचकर फिर कोशिश करें।',
  'No internet. Showing what was saved {when}.': 'इंटरनेट नहीं है। {when} सेव किया हुआ दिखा रहे हैं।', 'Loading': 'लोड हो रहा है', 'Loading bills': 'बिल लोड हो रहे हैं',
  'Loading customers': 'ग्राहक लोड हो रहे हैं', 'Loading the product': 'प्रोडक्ट लोड हो रहा है', 'Loading the order': 'ऑर्डर लोड हो रहा है', 'Loading tickets': 'टिकट लोड हो रहे हैं',
  'Loading held bills': 'होल्ड बिल लोड हो रहे हैं', 'Loading the floor': 'फ़्लोर लोड हो रहा है', "Loading today's figures": 'आज के आँकड़े लोड हो रहे हैं',
  '{done} of {total}': '{total} में से {done}', '{at} of {total}': '{total} में से {at}', 'Skip': 'छोड़ें',
  'Tap what you want to do.': 'जो करना है उस पर टैप करें।',
  'Offer': 'ऑफ़र', 'Menu': 'मेन्यू', 'Bill': 'बिल', 'See': 'देखें', 'sign in again': 'फिर साइन इन करें', 'no internet': 'इंटरनेट नहीं',
  '{n} item · GST {gst}': '{n} आइटम · GST {gst}', '{n} items · GST {gst}': '{n} आइटम · GST {gst}', 'Clear this bill?': 'यह बिल साफ़ करें?', 'All {n} items will be removed.': 'सभी {n} आइटम हट जाएँगे।',
  'Keep the bill': 'बिल रखें', 'Customer: {name}. Tap to remove.': 'ग्राहक: {name}। हटाने के लिए टैप करें।', 'Hold this bill': 'यह बिल होल्ड करें', '{n} bill needs a decision': '{n} बिल पर फ़ैसला चाहिए', '{n} bills need a decision': '{n} बिलों पर फ़ैसला चाहिए', '{n} bill waiting to send': '{n} बिल भेजने के इंतज़ार में', '{n} bills waiting to send': '{n} बिल भेजने के इंतज़ार में',
  'Good morning': 'सुप्रभात', 'Good afternoon': 'नमस्कार', 'Good evening': 'शुभ संध्या', 'Last {n} days': 'पिछले {n} दिन',
  'Open your authenticator app and type the 6-digit code for FlowXP. Lost your phone? Type a recovery code instead.': 'अपना ऑथेंटिकेटर ऐप खोलें और FlowXP का 6 अंकों का कोड लिखें। फ़ोन खो गया? इसकी जगह रिकवरी कोड लिखें।',
  'Refresh the product list': 'प्रोडक्ट सूची रीफ़्रेश करें',
  '{n} changes need a decision': '{n} बदलावों पर फ़ैसला चाहिए', '{n} changes waiting to send': '{n} बदलाव भेजने के इंतज़ार में', 'Changes waiting to send': 'भेजने के इंतज़ार में बदलाव',
  // language
  'Language': 'भाषा', 'Choose the language the app is shown in.': 'ऐप किस भाषा में दिखे, चुनें।',
  // sign in
  'Sign in with the email and password you use on flowxp.in.': 'flowxp.in पर इस्तेमाल होने वाले ईमेल और पासवर्ड से साइन इन करें।',
  'Your sign-in stays on this phone, in its secure storage.': 'आपका साइन-इन इस फ़ोन की सुरक्षित स्टोरेज में रहता है।',
  // hints
  'Making a bill': 'बिल बनाना', 'Tap an item to add it. Tap Bill to check it, then Take payment. The total shown is about right: the exact amount is worked out when you pay.': 'आइटम पर टैप करके जोड़ें। जाँचने के लिए बिल दबाएँ, फिर पेमेंट लें। दिखाया गया टोटल लगभग सही है; सही रक़म पेमेंट के समय तय होती है।',
  'No internet? Keep billing': 'इंटरनेट नहीं? बिल बनाते रहें', 'Bills are saved on this phone and sent to FlowXP by themselves when the signal is back. You do not need to do anything.': 'बिल इस फ़ोन पर सेव होते हैं और इंटरनेट आने पर अपने आप FlowXP को भेज दिए जाते हैं। आपको कुछ नहीं करना है।',
  'Tap a free table to start an order. Tap a busy one to add items, send them to the kitchen, or bill.': 'ऑर्डर शुरू करने के लिए खाली टेबल पर टैप करें। भरी टेबल पर आइटम जोड़ें, किचन को भेजें, या बिल बनाएँ।',
  'An order': 'एक ऑर्डर', 'Add items, then Send to kitchen. When the food is ready, mark it served. Bill and pay when the table is done.': 'आइटम जोड़ें, फिर किचन को भेजें। खाना तैयार होने पर परोसा गया चिह्नित करें। टेबल पूरी होने पर बिल बनाएँ।',
  'Tap a product to change its price or fix its stock. Add product is for something new.': 'कीमत बदलने या स्टॉक ठीक करने के लिए प्रोडक्ट पर टैप करें। नई चीज़ के लिए प्रोडक्ट जोड़ें दबाएँ।',
  'Tap a dish when it is done. Rush puts a table first. Undo stays on screen for a few seconds after every tap.': 'डिश तैयार होने पर उस पर टैप करें। जल्दी दबाने से वह टेबल सबसे पहले आती है। हर टैप के बाद कुछ सेकंड के लिए वापस का बटन रहता है।',
  // tour
  'Make a bill in three taps': 'तीन टैप में बिल बनाएँ', 'Tap the items.': 'आइटम पर टैप करें।', 'Tap Take payment.': 'पेमेंट लें दबाएँ।', 'Hand over the bill.': 'बिल ग्राहक को दें।',
  'No internet? Keep selling': 'इंटरनेट नहीं? बिक्री जारी रखें', 'Bills are saved on this phone.': 'बिल इस फ़ोन पर सेव होते हैं।', 'They are sent by themselves when the signal returns.': 'इंटरनेट लौटने पर वे अपने आप भेज दिए जाते हैं।',
  'Tables and the kitchen': 'टेबल और किचन', 'Open a table, add items, send to the kitchen.': 'टेबल खोलें, आइटम जोड़ें, किचन को भेजें।', 'Cooks tap a dish when it is ready. You see it here.': 'कुक डिश तैयार होने पर टैप करते हैं। आप उसे यहाँ देखते हैं।',
  'Everything else is under More': 'बाकी सब "और" में है', 'Products, customers, stock and reports.': 'प्रोडक्ट, ग्राहक, स्टॉक और रिपोर्ट।', 'Help is always at the top of More.': 'मदद हमेशा "और" के ऊपर है।',
  // checklist
  'Getting started': 'शुरुआत', 'Make your first bill': 'अपना पहला बिल बनाएँ', 'Tap items, then Take payment.': 'आइटम टैप करें, फिर पेमेंट लें।', 'Scan a barcode': 'बारकोड स्कैन करें',
  'Point the camera at a product to add it.': 'जोड़ने के लिए कैमरा प्रोडक्ट की ओर करें।', 'Open a table': 'टेबल खोलें', 'Tap a free table to start an order.': 'ऑर्डर शुरू करने के लिए खाली टेबल पर टैप करें।',
  'See the kitchen screen': 'किचन स्क्रीन देखें', 'What the cooks see when you send an order.': 'ऑर्डर भेजने पर कुक क्या देखते हैं।', 'Hold a bill for later': 'बिल बाद के लिए होल्ड करें',
  'Put a bill aside when a customer steps away.': 'ग्राहक के हटने पर बिल अलग रख दें।', 'Look at your bills': 'अपने बिल देखें', 'Every bill you make is listed here.': 'आपके बनाए सारे बिल यहाँ दिखते हैं।',
  'Hide this. You can bring it back from Help.': 'इसे छिपाएँ। मदद से वापस ला सकते हैं।',
  // help guide
  'Make a bill': 'बिल बनाएँ', 'Keep billing when the internet is off': 'इंटरनेट बंद होने पर भी बिल बनाएँ', 'Change a price': 'कीमत बदलें', 'Fix a stock count': 'स्टॉक की गिनती ठीक करें',
  'Put a customer on a bill': 'बिल पर ग्राहक जोड़ें', 'Print a receipt': 'रसीद छापें', 'Take an order at a table': 'टेबल पर ऑर्डर लें', 'Use the kitchen screen': 'किचन स्क्रीन इस्तेमाल करें',
  'Open Sell.': 'बिक्री खोलें।', 'Tap the items on the menu. A drink with choices asks for size or milk first.': 'मेन्यू से आइटम टैप करें। विकल्प वाली ड्रिंक पहले साइज़ या दूध पूछती है।',
  'Tap an item, or scan its barcode with Scan.': 'आइटम टैप करें, या स्कैन से उसका बारकोड पढ़ें।', 'Check the bill with the Bill button. Use + and − to change a quantity.': 'बिल बटन से बिल जाँचें। मात्रा बदलने के लिए + और − दबाएँ।',
  'Tap Take payment, choose Cash, UPI or Card, then confirm.': 'पेमेंट लें दबाएँ, नकद, UPI या कार्ड चुनें, फिर पक्का करें।', 'Hand over the bill: Print or Share it, then tap New bill.': 'बिल दें: छापें या शेयर करें, फिर नया बिल दबाएँ।',
  'Just carry on. Make bills as usual.': 'बस जारी रखें। हमेशा की तरह बिल बनाएँ।', 'The line at the top says how many bills are waiting to send.': 'ऊपर की लाइन बताती है कि कितने बिल भेजने के इंतज़ार में हैं।',
  'When the signal is back they are sent by themselves, once each, in order.': 'इंटरनेट आने पर वे अपने आप, एक-एक बार, क्रम से भेज दिए जाते हैं।', 'A bill FlowXP cannot accept stays in Bills with the reason, for you to decide.': 'जो बिल FlowXP स्वीकार नहीं कर सकता वह कारण के साथ बिल में रहता है, आप फ़ैसला करें।',
  'On Sell, tap Hold and give it a name, like "Ravi" or "blue shirt".': 'बिक्री पर होल्ड दबाएँ और नाम दें, जैसे "रवि" या "नीली शर्ट"।', 'The till is clear for the next customer.': 'अगले ग्राहक के लिए बिल खाली है।', 'To carry on: More, then Bills on hold, then Resume.': 'आगे बढ़ने के लिए: और, फिर होल्ड पर बिल, फिर जारी रखें।',
  'Open Products and tap the item.': 'प्रोडक्ट खोलें और आइटम पर टैप करें।', 'Type the new price under Change the price.': 'कीमत बदलें के नीचे नई कीमत लिखें।', 'Tap Save price. New bills use it straight away.': 'कीमत सेव करें दबाएँ। नए बिल तुरंत इसे इस्तेमाल करते हैं।',
  'Open More, then Stock, and tap the item.': 'और खोलें, फिर स्टॉक, और आइटम पर टैप करें।', 'Type how many to add, or a minus number to take away.': 'कितने जोड़ने हैं लिखें, या घटाने के लिए माइनस नंबर लिखें।', 'Say why (counted, damaged, received) and tap Update stock.': 'कारण लिखें (गिनती, खराब, प्राप्त) और स्टॉक अपडेट करें दबाएँ।',
  'On Sell, tap Add customer.': 'बिक्री पर ग्राहक जोड़ें दबाएँ।', 'Search by name or phone, or tap Add customer for a new one.': 'नाम या फ़ोन से खोजें, या नए के लिए ग्राहक जोड़ें दबाएँ।', 'Their bill is saved under their name, and they earn their visit card stamp.': 'बिल उनके नाम से सेव होता है, और उन्हें विज़िट कार्ड की मुहर मिलती है।',
  'Open More, then Settings, and choose 58 mm or 80 mm paper.': 'और खोलें, फिर सेटिंग्स, और 58 mm या 80 mm कागज़ चुनें।', 'Tap Print a test receipt to check it lines up.': 'सही बैठ रहा है यह जाँचने के लिए टेस्ट रसीद छापें दबाएँ।', 'After any bill, tap Print.': 'किसी भी बिल के बाद छापें दबाएँ।',
  'Open Tables and tap a free table.': 'टेबल खोलें और खाली टेबल पर टैप करें।', 'Tap Add items, then tap what the guests want.': 'आइटम जोड़ें दबाएँ, फिर मेहमानों की पसंद पर टैप करें।', 'Tap Send to kitchen. The cooks see it at once.': 'किचन को भेजें दबाएँ। कुक उसे तुरंत देखते हैं।',
  'When the food is ready, tap Mark served.': 'खाना तैयार होने पर परोसा गया दबाएँ।', 'When the table is done, tap Bill and pay.': 'टेबल पूरी होने पर बिल और पेमेंट दबाएँ।',
  'Open More, then Kitchen screen. Leave it open: it stays awake and refreshes itself.': 'और खोलें, फिर किचन स्क्रीन। इसे खुला छोड़ दें: यह जागा रहता है और अपने आप रिफ़्रेश होता है।', 'Tap a dish when it is done, or All ready for the whole ticket.': 'डिश तैयार होने पर टैप करें, या पूरे टिकट के लिए सब तैयार दबाएँ।',
  'Rush puts a table first. Undo is on the bar for a few seconds.': 'जल्दी से टेबल सबसे पहले आती है। वापस का बटन कुछ सेकंड बार पर रहता है।', 'The phone buzzes for a new order, and for a dish that is late.': 'नए ऑर्डर और देर वाली डिश पर फ़ोन कंपन करता है।',
  'Go to Sell': 'बिक्री पर जाएँ', 'See held bills': 'होल्ड बिल देखें', 'Go to Products': 'प्रोडक्ट पर जाएँ', 'Go to Stock': 'स्टॉक पर जाएँ', 'Go to Customers': 'ग्राहक पर जाएँ', 'Printer settings': 'प्रिंटर सेटिंग्स', 'Go to Tables': 'टेबल पर जाएँ', 'Open the kitchen screen': 'किचन स्क्रीन खोलें', 'Try it now': 'अभी आज़माएँ'
};

/** Languages that have a dictionary. */
export const DICTS: Partial<Record<Lang, Record<string, string>>> = { hi: HI };
