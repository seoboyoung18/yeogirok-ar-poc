import { ViroMaterials, ViroNode, ViroPolygon } from '@reactvision/react-viro';
import type { Point3 } from './placement';

ViroMaterials.createMaterials({
  tipPinDraft: {
    diffuseColor: '#ff6b35',
    lightingModel: 'Constant',
    cullMode: 'None',
  },
  tipPinConfirmed: {
    diffuseColor: '#2374e1',
    lightingModel: 'Constant',
    cullMode: 'None',
  },
  tipPinCenter: {
    diffuseColor: '#ffffff',
    lightingModel: 'Constant',
    cullMode: 'None',
  },
});

// Model units are metres. The bottom tip is exactly the root's [0, 0, 0].
const outline: [number, number][] = [
  [0, 0],
  [0.075, 0.11],
  [0.09, 0.17],
  [0.075, 0.23],
  [0.04, 0.255],
  [0, 0.265],
  [-0.04, 0.255],
  [-0.075, 0.23],
  [-0.09, 0.17],
  [-0.075, 0.11],
];
const center: [number, number][] = Array.from({ length: 24 }, (_, i) => {
  const angle = (i / 24) * Math.PI * 2;
  return [Math.cos(angle) * 0.028, 0.18 + Math.sin(angle) * 0.028];
});

type Props = {
  position: Point3;
  confirmed: boolean;
  onDrag: (position: Point3) => void;
};

export default function ARTipMarker({ position, confirmed, onDrag }: Props) {
  return (
    <ViroNode
      position={position}
      dragType="FixedToWorld"
      onDrag={confirmed ? undefined : onDrag}
    >
      <ViroNode transformBehaviors={['billboardY']}>
        <ViroPolygon
          vertices={outline}
          holes={[]}
          materials={[confirmed ? 'tipPinConfirmed' : 'tipPinDraft']}
        />
        <ViroPolygon
          vertices={center}
          holes={[]}
          position={[0, 0, 0.002]}
          materials={['tipPinCenter']}
        />
      </ViroNode>
    </ViroNode>
  );
}
