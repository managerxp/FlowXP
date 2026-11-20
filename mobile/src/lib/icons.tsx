/*
 * The app's icons: Lucide (lucide.dev), drawn as light line icons. The screens still ask for icons by the names they always used (home-outline, cart, ...), and this maps each name
 * to its Lucide icon, so one place decides the icon set. A name that is not listed does not compile (see IconName). The chosen tab uses a heavier line instead of a filled icon.
 */
import type { ColorValue, StyleProp, TextStyle } from 'react-native';
import ArrowDown from 'lucide-react-native/icons/arrow-down';
import ArrowLeftRight from 'lucide-react-native/icons/arrow-left-right';
import ArrowUp from 'lucide-react-native/icons/arrow-up';
import ArrowUpDown from 'lucide-react-native/icons/arrow-up-down';
import Award from 'lucide-react-native/icons/award';
import Banknote from 'lucide-react-native/icons/banknote';
import Bell from 'lucide-react-native/icons/bell';
import Bike from 'lucide-react-native/icons/bike';
import Bluetooth from 'lucide-react-native/icons/bluetooth';
import BookOpen from 'lucide-react-native/icons/book-open';
import Briefcase from 'lucide-react-native/icons/briefcase';
import BriefcaseMedical from 'lucide-react-native/icons/briefcase-medical';
import Bug from 'lucide-react-native/icons/bug';
import Building2 from 'lucide-react-native/icons/building-2';
import Bus from 'lucide-react-native/icons/bus';
import Calendar from 'lucide-react-native/icons/calendar';
import CalendarDays from 'lucide-react-native/icons/calendar-days';
import Car from 'lucide-react-native/icons/car';
import ChartColumn from 'lucide-react-native/icons/chart-column';
import ChartLine from 'lucide-react-native/icons/chart-line';
import Check from 'lucide-react-native/icons/check';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import ChevronUp from 'lucide-react-native/icons/chevron-up';
import Circle from 'lucide-react-native/icons/circle';
import CircleAlert from 'lucide-react-native/icons/circle-alert';
import CircleCheck from 'lucide-react-native/icons/circle-check';
import CircleHelp from 'lucide-react-native/icons/circle-help';
import CirclePause from 'lucide-react-native/icons/circle-pause';
import CircleUser from 'lucide-react-native/icons/circle-user';
import CircleX from 'lucide-react-native/icons/circle-x';
import ClipboardList from 'lucide-react-native/icons/clipboard-list';
import Clock from 'lucide-react-native/icons/clock';
import CloudOff from 'lucide-react-native/icons/cloud-off';
import CloudUpload from 'lucide-react-native/icons/cloud-upload';
import CreditCard from 'lucide-react-native/icons/credit-card';
import Download from 'lucide-react-native/icons/download';
import Dumbbell from 'lucide-react-native/icons/dumbbell';
import FileText from 'lucide-react-native/icons/file-text';
import Flame from 'lucide-react-native/icons/flame';
import FlaskConical from 'lucide-react-native/icons/flask-conical';
import Gamepad2 from 'lucide-react-native/icons/gamepad-2';
import Gift from 'lucide-react-native/icons/gift';
import GitPullRequest from 'lucide-react-native/icons/git-pull-request';
import Hammer from 'lucide-react-native/icons/hammer';
import Heart from 'lucide-react-native/icons/heart';
import Hourglass from 'lucide-react-native/icons/hourglass';
import House from 'lucide-react-native/icons/house';
import Inbox from 'lucide-react-native/icons/inbox';
import Layers from 'lucide-react-native/icons/layers';
import LayoutGrid from 'lucide-react-native/icons/layout-grid';
import LifeBuoy from 'lucide-react-native/icons/life-buoy';
import Lightbulb from 'lucide-react-native/icons/lightbulb';
import List from 'lucide-react-native/icons/list';
import LogOut from 'lucide-react-native/icons/log-out';
import Map from 'lucide-react-native/icons/map';
import Menu from 'lucide-react-native/icons/menu';
import MessageCircle from 'lucide-react-native/icons/message-circle';
import MessagesSquare from 'lucide-react-native/icons/messages-square';
import Navigation from 'lucide-react-native/icons/navigation';
import Package from 'lucide-react-native/icons/package';
import Palette from 'lucide-react-native/icons/palette';
import Paperclip from 'lucide-react-native/icons/paperclip';
import Pizza from 'lucide-react-native/icons/pizza';
import Plus from 'lucide-react-native/icons/plus';
import Printer from 'lucide-react-native/icons/printer';
import QrCode from 'lucide-react-native/icons/qr-code';
import Receipt from 'lucide-react-native/icons/receipt';
import ScanLine from 'lucide-react-native/icons/scan-line';
import Scissors from 'lucide-react-native/icons/scissors';
import Search from 'lucide-react-native/icons/search';
import Send from 'lucide-react-native/icons/send';
import Settings from 'lucide-react-native/icons/settings';
import Shield from 'lucide-react-native/icons/shield';
import ShieldCheck from 'lucide-react-native/icons/shield-check';
import Shirt from 'lucide-react-native/icons/shirt';
import ShoppingCart from 'lucide-react-native/icons/shopping-cart';
import SlidersHorizontal from 'lucide-react-native/icons/sliders-horizontal';
import Smartphone from 'lucide-react-native/icons/smartphone';
import Sparkles from 'lucide-react-native/icons/sparkles';
import Star from 'lucide-react-native/icons/star';
import Store from 'lucide-react-native/icons/store';
import Tag from 'lucide-react-native/icons/tag';
import Tags from 'lucide-react-native/icons/tags';
import Timer from 'lucide-react-native/icons/timer';
import TrendingDown from 'lucide-react-native/icons/trending-down';
import TrendingUp from 'lucide-react-native/icons/trending-up';
import TriangleAlert from 'lucide-react-native/icons/triangle-alert';
import Trophy from 'lucide-react-native/icons/trophy';
import Type from 'lucide-react-native/icons/type';
import Undo2 from 'lucide-react-native/icons/undo-2';
import User from 'lucide-react-native/icons/user';
import UserPlus from 'lucide-react-native/icons/user-plus';
import Users from 'lucide-react-native/icons/users';
import UtensilsCrossed from 'lucide-react-native/icons/utensils-crossed';
import Wallet from 'lucide-react-native/icons/wallet';
import Wifi from 'lucide-react-native/icons/wifi';
import Wrench from 'lucide-react-native/icons/wrench';

const MAP = {
  'add': Plus,
  'alert': TriangleAlert,
  'alert-circle-outline': CircleAlert,
  'analytics-outline': ChartLine,
  'barbell-outline': Dumbbell,
  'bicycle-outline': Bike,
  'bluetooth-outline': Bluetooth,
  'book-outline': BookOpen,
  'briefcase-outline': Briefcase,
  'bug-outline': Bug,
  'build': Wrench,
  'build-outline': Wrench,
  'bulb-outline': Lightbulb,
  'bus-outline': Bus,
  'business-outline': Building2,
  'calendar': Calendar,
  'calendar-outline': Calendar,
  'calendar-number-outline': CalendarDays,
  'car': Car,
  'car-outline': Car,
  'card': CreditCard,
  'card-outline': CreditCard,
  'cart': ShoppingCart,
  'cart-outline': ShoppingCart,
  'cash-outline': Banknote,
  'chatbubble-outline': MessageCircle,
  'chatbubbles-outline': MessagesSquare,
  'checkmark': Check,
  'checkmark-circle': CircleCheck,
  'chevron-back': ChevronLeft,
  'chevron-down': ChevronDown,
  'chevron-forward': ChevronRight,
  'chevron-up': ChevronUp,
  'clipboard-outline': ClipboardList,
  'close-circle': CircleX,
  'cloud-offline-outline': CloudOff,
  'cloud-upload-outline': CloudUpload,
  'color-palette-outline': Palette,
  'construct-outline': Hammer,
  'cube': Package,
  'cube-outline': Package,
  'cut-outline': Scissors,
  'document-attach-outline': Paperclip,
  'document-text-outline': FileText,
  'download-outline': Download,
  'ellipse-outline': Circle,
  'file-tray-stacked-outline': Inbox,
  'flame-outline': Flame,
  'flask-outline': FlaskConical,
  'game-controller-outline': Gamepad2,
  'gift': Gift,
  'gift-outline': Gift,
  'git-pull-request-outline': GitPullRequest,
  'grid': LayoutGrid,
  'grid-outline': LayoutGrid,
  'heart': Heart,
  'heart-outline': Heart,
  'help-buoy-outline': LifeBuoy,
  'help-circle-outline': CircleHelp,
  'home': House,
  'home-outline': House,
  'hourglass-outline': Hourglass,
  'layers-outline': Layers,
  'list': List,
  'list-outline': List,
  'log-out-outline': LogOut,
  'map-outline': Map,
  'medkit-outline': BriefcaseMedical,
  'menu': Menu,
  'menu-outline': Menu,
  'navigate-outline': Navigation,
  'notifications-outline': Bell,
  'options': SlidersHorizontal,
  'options-outline': SlidersHorizontal,
  'pause-circle-outline': CirclePause,
  'people-circle-outline': Users,
  'people-outline': Users,
  'person-add-outline': UserPlus,
  'person-circle-outline': CircleUser,
  'person-outline': User,
  'phone-portrait-outline': Smartphone,
  'pizza': Pizza,
  'pricetag-outline': Tag,
  'pricetags-outline': Tags,
  'print': Printer,
  'print-outline': Printer,
  'qr-code-outline': QrCode,
  'receipt': Receipt,
  'receipt-outline': Receipt,
  'restaurant-outline': UtensilsCrossed,
  'return-down-back-outline': Undo2,
  'ribbon-outline': Award,
  'scan': ScanLine,
  'scan-outline': ScanLine,
  'search': Search,
  'search-outline': Search,
  'send': Send,
  'settings': Settings,
  'settings-outline': Settings,
  'shield-checkmark-outline': ShieldCheck,
  'shield-outline': Shield,
  'shirt': Shirt,
  'shirt-outline': Shirt,
  'sparkles': Sparkles,
  'sparkles-outline': Sparkles,
  'star': Star,
  'star-outline': Star,
  'stats-chart-outline': ChartColumn,
  'storefront-outline': Store,
  'swap-horizontal-outline': ArrowLeftRight,
  'swap-vertical-outline': ArrowUpDown,
  'text': Type,
  'time-outline': Clock,
  'timer-outline': Timer,
  'trending-down': TrendingDown,
  'trending-up': TrendingUp,
  'trending-up-outline': TrendingUp,
  'trophy-outline': Trophy,
  'wallet': Wallet,
  'wallet-outline': Wallet,
  'wifi-outline': Wifi,
  'arrow-down-outline': ArrowDown,
  'arrow-up-outline': ArrowUp,
  'warning': TriangleAlert
} as const;

export type IconName = keyof typeof MAP;

/** Names drawn heavier (the chosen tab). Star and heart are drawn filled. */
const HEAVY = new Set<string>(['home', 'build', 'wallet', 'cart', 'grid', 'calendar', 'heart', 'receipt', 'cube', 'menu']);
const FILLED = new Set<string>(['star', 'heart']);

/** Same call as the old Ionicons component: <Ionicons name="home-outline" size={24} color={...} />. */
export const Ionicons = ({ name, size = 24, color = '#000000', style }: { name: IconName; size?: number; color?: ColorValue; style?: StyleProp<TextStyle> }) => {
  const Icon = MAP[name] ?? CircleHelp;
  const c = color as string;
  return <Icon size={size} color={c} strokeWidth={HEAVY.has(name) ? 2.4 : 1.8} fill={FILLED.has(name) ? c : 'none'} style={style as never} />;
};
