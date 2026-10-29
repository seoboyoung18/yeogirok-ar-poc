import type { ViroARHitTestResult } from '@reactvision/react-viro';
import {
  createPlacementRecord,
  moveSelection,
  selectPlaneHit,
} from '../placement';

const timestamp = '2026-10-28T10:00:00.000Z';
function plane(
  position: [number, number, number] = [1, 2, 3],
): ViroARHitTestResult {
  return {
    type: 'ExistingPlaneUsingExtent',
    transform: { position, rotation: [90, 0, 0], scale: [1, 1, 1] },
    hasDepthData: false,
    _hitResultId: 'native-hit-id-must-not-be-exported',
  };
}

test('only finite plane-extent hits are accepted for initial placement', () => {
  const feature: ViroARHitTestResult = { ...plane(), type: 'FeaturePoint' };
  expect(selectPlaneHit([], 1, timestamp)).toBeNull();
  expect(
    selectPlaneHit([feature, plane([NaN, 1, 2])], 1, timestamp),
  ).toBeNull();
  const selected = selectPlaneHit([feature, plane([4, 5, 6])], 1, timestamp);
  expect(selected?.position).toEqual([4, 5, 6]);
});

test('dragged tip position is exported, not the initial hit or plane rotation', () => {
  const selected = selectPlaneHit([plane()], 7, timestamp)!;
  const moved = moveSelection(selected, [4, 5, 6], timestamp)!;
  const record = createPlacementRecord(moved, 'session-a', 7, true, timestamp);
  expect(record.localPose.positionMeters).toEqual([4, 5, 6]);
  expect(record.localPose.rotationQuaternionXYZW).toEqual([0, 0, 0, 1]);
  expect(record.localPose.referencePoint).toBe('pin-tip');
  expect(record.localPose.positionSource).toBe('fixed-to-world-drag');
  expect(record.initialHit.positionMeters).toEqual([1, 2, 3]);
  expect(record.initialHit.rotationDegrees).toEqual([90, 0, 0]);
  expect(record.geospatial.tipCoordinate).toBeNull();
  expect(record.geospatial.accuracy).toBeNull();
  expect(JSON.stringify(record)).not.toContain('native-hit-id');
});

test('tracking loss or a new placement generation prevents stale confirmation', () => {
  const selected = selectPlaneHit([plane()], 1, timestamp)!;
  expect(() =>
    createPlacementRecord(selected, 'a', 1, false, timestamp),
  ).toThrow();
  expect(() =>
    createPlacementRecord(selected, 'a', 2, true, timestamp),
  ).toThrow();
});

test('invalid drag positions are rejected and confirmed snapshots are independent', () => {
  const selected = selectPlaneHit([plane()], 1, timestamp)!;
  expect(moveSelection(selected, [Infinity, 0, 0], timestamp)).toBeNull();
  expect(moveSelection(selected, [0, 0], timestamp)).toBeNull();
  const record = createPlacementRecord(selected, 'a', 1, true, timestamp);
  selected.position[0] = 99;
  selected.initialHit.position[1] = 99;
  expect(record.localPose.positionMeters).toEqual([1, 2, 3]);
  expect(record.initialHit.positionMeters).toEqual([1, 2, 3]);
});
