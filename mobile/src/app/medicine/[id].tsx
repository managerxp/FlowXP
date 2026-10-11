import { useLocalSearchParams } from 'expo-router';
import { MedicineForm } from '../../lib/MedicineForm.tsx';

/* Change a medicine: its name, strength, prices, rules and tracking. */
export default function EditMedicine() { const { id } = useLocalSearchParams<{ id: string }>(); return <MedicineForm id={id} />; }
