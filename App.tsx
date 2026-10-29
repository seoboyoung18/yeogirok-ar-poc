import { useState } from 'react';
import TipHome from './TipHome';
import ValidationLab from './ValidationLab';

export default function App() {
  const [lab, setLab] = useState(false);
  return lab ? (
    <ValidationLab onBack={() => setLab(false)} />
  ) : (
    <TipHome onLab={() => setLab(true)} />
  );
}
