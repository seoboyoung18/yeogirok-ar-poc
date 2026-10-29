export type Coordinate = { latitude: number; longitude: number };
export type GeoCoordinate = Coordinate & {
  altitude: number;
  altitudeReference: 'WGS84_ELLIPSOID';
  eusQuaternion: [number, number, number, number];
};
export type ReferencePoint = Coordinate & {
  source: 'map-tap' | 'manual-coordinate' | 'surveyed';
  sourceLabel: string;
  uncertaintyMeters: number | null;
  capturedAt: string;
};
export type GeoRecord = {
  schemaVersion: 2;
  kind: 'yeogirok-geospatial-placement';
  recordId: string;
  sessionId: string;
  confirmedAt: string;
  tip: GeoCoordinate;
  cameraAtCapture?: GeoCoordinate;
  accuracy: {
    horizontalMeters: number;
    verticalMeters: number;
    yawDegrees: number;
    confidence: number;
    source: string;
    measuredError: null;
  };
  reference?: ReferencePoint;
  restoredFrom?: string | null;
  restorationTarget?: GeoCoordinate;
  restorationEstimate?: {
    horizontalOffsetMeters: number;
    verticalOffsetMeters: number;
    method: 'arcore-plane-hit-test';
    deviceLabel: string;
    estimatedAt: string;
    groundTruth: false;
  };
  restorationObservation?: {
    horizontalOffsetMeters: number;
    verticalOffsetMeters: number | null;
    method: string;
    deviceLabel: string;
    observedAt: string;
  };
  crossDeviceVerified: false;
};

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('JSON 객체가 필요합니다.');
  }
  return value as Record<string, unknown>;
}
function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
export function assertCoordinate(value: unknown): asserts value is Coordinate {
  const p = object(value);
  if (
    !finite(p.latitude) ||
    !finite(p.longitude) ||
    Math.abs(p.latitude) > 90 ||
    Math.abs(p.longitude) > 180
  ) {
    throw new Error('위도·경도 범위가 올바르지 않습니다.');
  }
}
function assertGeo(value: unknown): asserts value is GeoCoordinate {
  assertCoordinate(value);
  const p = object(value);
  const q = p.eusQuaternion;
  if (
    Math.abs(value.latitude) >= 89.9 ||
    !finite(p.altitude) ||
    p.altitudeReference !== 'WGS84_ELLIPSOID' ||
    !Array.isArray(q) ||
    q.length !== 4 ||
    !q.every(finite) ||
    Math.abs(Math.hypot(...q) - 1) >= 0.01
  ) {
    throw new Error('고도 기준 또는 방향 쿼터니언이 올바르지 않습니다.');
  }
}

export function parseGeoRecord(raw: string): GeoRecord {
  if (raw.length > 65536) {
    throw new Error('JSON 기록은 64KB 이내로 입력하세요.');
  }
  const record = object(JSON.parse(raw));
  if (
    record.schemaVersion !== 2 ||
    record.kind !== 'yeogirok-geospatial-placement'
  ) {
    throw new Error(
      '지리 좌표 기록이 아닙니다. Viro 세션 XYZ는 지도 좌표로 쓸 수 없습니다.',
    );
  }
  assertGeo(record.tip);
  if (record.cameraAtCapture !== undefined) {
    assertGeo(record.cameraAtCapture);
  }
  for (const field of ['recordId', 'sessionId', 'confirmedAt']) {
    if (
      typeof record[field] !== 'string' ||
      !(record[field] as string).trim()
    ) {
      throw new Error(`기록에 ${field}가 없습니다.`);
    }
  }
  if (!Number.isFinite(Date.parse(record.confirmedAt as string))) {
    throw new Error('측정 시각이 올바르지 않습니다.');
  }
  const accuracy = object(record.accuracy);
  for (const key of ['horizontalMeters', 'verticalMeters', 'yawDegrees']) {
    if (!finite(accuracy[key]) || (accuracy[key] as number) < 0) {
      throw new Error('추정 정확도 값이 올바르지 않습니다.');
    }
  }
  if (accuracy.confidence !== 0.68 || typeof accuracy.source !== 'string') {
    throw new Error('정확도의 신뢰구간 또는 출처가 올바르지 않습니다.');
  }
  if (record.reference !== undefined) {
    assertCoordinate(record.reference);
    const ref = object(record.reference);
    if (
      !['map-tap', 'manual-coordinate', 'surveyed'].includes(
        String(ref.source),
      ) ||
      typeof ref.sourceLabel !== 'string' ||
      !ref.sourceLabel.trim() ||
      typeof ref.capturedAt !== 'string' ||
      !Number.isFinite(Date.parse(ref.capturedAt)) ||
      (ref.uncertaintyMeters !== null &&
        (!finite(ref.uncertaintyMeters) || ref.uncertaintyMeters < 0))
    ) {
      throw new Error('기준점의 출처·시각·불확실성을 확인하세요.');
    }
  }
  if (record.restorationTarget !== undefined) {
    assertGeo(record.restorationTarget);
  }
  if (record.restorationEstimate !== undefined) {
    const estimate = object(record.restorationEstimate);
    if (
      !record.restoredFrom ||
      !finite(estimate.horizontalOffsetMeters) ||
      estimate.horizontalOffsetMeters < 0 ||
      !finite(estimate.verticalOffsetMeters) ||
      estimate.method !== 'arcore-plane-hit-test' ||
      typeof estimate.deviceLabel !== 'string' ||
      !estimate.deviceLabel.trim() ||
      typeof estimate.estimatedAt !== 'string' ||
      !Number.isFinite(Date.parse(estimate.estimatedAt)) ||
      estimate.groundTruth !== false
    ) {
      throw new Error('AR 복원 추정값의 측정 방법·기기·시간을 확인하세요.');
    }
  }
  if (record.restorationObservation !== undefined) {
    const observation = object(record.restorationObservation);
    if (
      !record.restoredFrom ||
      !finite(observation.horizontalOffsetMeters) ||
      observation.horizontalOffsetMeters < 0 ||
      (observation.verticalOffsetMeters !== null &&
        !finite(observation.verticalOffsetMeters)) ||
      typeof observation.method !== 'string' ||
      !observation.method.trim() ||
      typeof observation.deviceLabel !== 'string' ||
      !observation.deviceLabel.trim() ||
      typeof observation.observedAt !== 'string' ||
      !Number.isFinite(Date.parse(observation.observedAt))
    ) {
      throw new Error('복원 실측값과 측정 방법·기기·시간을 확인하세요.');
    }
  }
  // A shared/imported file cannot establish successful cross-device validation.
  record.crossDeviceVerified = false;
  accuracy.measuredError = null;
  return record as unknown as GeoRecord;
}

/** Horizontal great-circle distance on a mean-radius sphere, not altitude/slant distance. */
export function horizontalDistanceMeters(a: Coordinate, b: Coordinate): number {
  assertCoordinate(a);
  assertCoordinate(b);
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const dlat = lat2 - lat1;
  const dlon = toRadians(b.longitude - a.longitude);
  const h = Math.min(
    1,
    Math.max(
      0,
      Math.sin(dlat / 2) ** 2 +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dlon / 2) ** 2,
    ),
  );
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function compareReference(record: GeoRecord) {
  if (!record.reference) {
    return null;
  }
  return {
    horizontalSeparationMeters: horizontalDistanceMeters(
      record.tip,
      record.reference,
    ),
    method: 'haversine-mean-earth-radius-6371008.8m',
    referenceSource: record.reference.source,
    referenceUncertaintyMeters: record.reference.uncertaintyMeters,
    interpretation:
      record.reference.source === 'surveyed'
        ? '기준점의 측량 불확실성을 함께 고려해야 합니다.'
        : '참고 비교값입니다. 지도·입력 오차가 포함되며 실제 오차를 확정하지 않습니다.',
    arRestorationVerified: false,
  };
}
