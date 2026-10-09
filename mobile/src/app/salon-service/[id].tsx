import { useLocalSearchParams } from 'expo-router';
import { ServiceForm } from '../../lib/ServiceForm.tsx';

/* Change a service: its name, price, time, GST, category and who it is for. */
export default function EditService() { const { id } = useLocalSearchParams<{ id: string }>(); return <ServiceForm id={id} />; }
