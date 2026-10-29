import type { ViroARHitTestResult } from '@reactvision/react-viro';

export type Point3 = [number, number, number];
export type PlacementSelection = {
  position: Point3;
  initialHit: {
    type: ViroARHitTestResult['type'];
    position: Point3;
    rotationDegrees: Point3;
  };
  positionSource: 'plane-hit-test' | 'fixed-to-world-drag';
  updatedAt: string;
  generation: number;
};

export function isPoint3(value: unknown): value is Point3 {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every(
      component => typeof component === 'number' && Number.isFinite(component),
    )
  );
}

export function selectPlaneHit(
  results: ViroARHitTestResult[],
  generation: number,
  now: string,
): PlacementSelection | null {
  const hit = results.find(
    result =>
      result.type === 'ExistingPlaneUsingExtent' &&
      isPoint3(result.transform?.position) &&
      isPoint3(result.transform?.rotation),
  );
  if (!hit) {
    return null;
  }
  return {
    position: [...hit.transform.position],
    initialHit: {
      type: hit.type,
      position: [...hit.transform.position],
      rotationDegrees: [...hit.transform.rotation],
    },
    positionSource: 'plane-hit-test',
    updatedAt: now,
    generation,
  };
}

export function moveSelection(
  selection: PlacementSelection,
  position: unknown,
  now: string,
): PlacementSelection | null {
  if (!isPoint3(position)) {
    return null;
  }
  return {
    ...selection,
    position: [...position],
    positionSource: 'fixed-to-world-drag',
    updatedAt: now,
  };
}

export function createPlacementRecord(
  selection: PlacementSelection,
  sessionId: string,
  generation: number,
  trackingNormal: boolean,
  now: string,
) {
  if (!trackingNormal || selection.generation !== generation) {
    throw new Error('추적 상태가 바뀌었습니다. 다시 배치해 주세요.');
  }
  if (!isPoint3(selection.position)) {
    throw new Error('유효한 위치가 아닙니다.');
  }
  return {
    schemaVersion: 1,
    kind: 'yeogirok-local-placement',
    sessionId,
    confirmedAt: now,
    positionUpdatedAt: selection.updatedAt,
    localPose: {
      frame: 'viro-ar-session',
      positionMeters: [...selection.position],
      // Pin root stays upright and unrotated. Only its visual child billboards.
      // This is deliberately NOT the original hit plane's orientation.
      rotationQuaternionXYZW: [0, 0, 0, 1],
      referencePoint: 'pin-tip',
      positionSource: selection.positionSource,
    },
    initialHit: {
      type: selection.initialHit.type,
      positionMeters: [...selection.initialHit.position],
      rotationDegrees: [...selection.initialHit.rotationDegrees],
    },
    geospatial: {
      status: 'unavailable',
      reason: 'same-session-pose-conversion-not-implemented',
      tipCoordinate: null,
      accuracy: null,
    },
    anchor: { status: 'not-created' },
  } as const;
}

export type PlacementRecord = ReturnType<typeof createPlacementRecord>;
