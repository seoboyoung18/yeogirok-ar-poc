export type CloudRecord = {
  schemaVersion: 1;
  kind: 'yeogirok-cloud-anchor';
  recordId: string;
  anchorType: 'CLOUD';
  anchorId: string;
  ttlDays: 1;
  hostedAt: string;
  expiresAtEstimate: string;
  hostSessionId: string;
  hostDeviceLabel: string;
  featureMapQuality: 'GOOD' | 'SUFFICIENT' | 'INSUFFICIENT';
  qualityPolicy: 'GOOD_STABLE' | 'DIAGNOSTIC_CURRENT_QUALITY';
  hitType: 'PLANE' | 'DEPTH';
  depthEnabled: boolean;
  depthHitAllowed: boolean;
  geospatial: null;
  discoveryLocation?: {
    latitude: number;
    longitude: number;
    source: 'MAP_SELECTED';
    uncertaintyMeters: null;
    capturedAt: string;
  };
  crossDeviceVerified: false;
  localPose: {
    frame: 'native-arcore-session';
    positionMeters: number[];
    rotationQuaternionXYZW: number[];
  };
  operation: {
    type: 'HOST' | 'RESOLVE';
    sessionId: string;
    deviceLabel: string;
    recordedAt: string;
    durationMs: number;
  };
  restorationEstimate?: {
    horizontalOffsetMeters: number;
    verticalOffsetMeters: number;
    referenceHitType: 'PLANE' | 'DEPTH';
    groundTruth: false;
  };
};

function requireValue(condition: unknown): asserts condition {
  if (!condition) {
    throw new Error('Cloud Anchor JSON의 형식이나 값이 올바르지 않습니다.');
  }
}
function object(value: unknown): Record<string, unknown> {
  requireValue(
    value !== null && typeof value === 'object' && !Array.isArray(value),
  );
  return value as Record<string, unknown>;
}
const nonempty = (v: unknown) => typeof v === 'string' && v.trim().length > 0;
const finite = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);
const hitType = (v: unknown) => v === 'PLANE' || v === 'DEPTH';
function date(value: unknown): number {
  requireValue(
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(value),
  );
  const time = Date.parse(value);
  requireValue(Number.isFinite(time));
  return time;
}

export function parseCloudRecord(
  raw: string,
  forResolve = false,
  nowMs = Date.now(),
): CloudRecord {
  requireValue(raw.length <= 65536);
  const r = object(JSON.parse(raw));
  requireValue(
    r.schemaVersion === 1 &&
      r.kind === 'yeogirok-cloud-anchor' &&
      r.anchorType === 'CLOUD',
  );
  requireValue(
    typeof r.anchorId === 'string' &&
      r.anchorId.length > 0 &&
      r.anchorId.length <= 512 &&
      !Array.from(r.anchorId).some(
        c =>
          /\s/.test(c) ||
          c.charCodeAt(0) < 32 ||
          (c.charCodeAt(0) >= 127 && c.charCodeAt(0) <= 159),
      ),
  );
  requireValue(
    nonempty(r.recordId) &&
      nonempty(r.hostSessionId) &&
      nonempty(r.hostDeviceLabel),
  );
  requireValue(r.ttlDays === 1);
  if (r.qualityPolicy === undefined) {
    r.qualityPolicy = 'GOOD_STABLE';
  }
  requireValue(
    r.qualityPolicy === 'GOOD_STABLE' ||
      r.qualityPolicy === 'DIAGNOSTIC_CURRENT_QUALITY',
  );
  requireValue(
    r.featureMapQuality === 'GOOD' ||
      (r.qualityPolicy === 'DIAGNOSTIC_CURRENT_QUALITY' &&
        (r.featureMapQuality === 'SUFFICIENT' ||
          r.featureMapQuality === 'INSUFFICIENT')),
  );
  const hosted = date(r.hostedAt);
  const expires = date(r.expiresAtEstimate);
  requireValue(expires - hosted === 86400000);
  if (forResolve && nowMs >= expires) {
    throw new Error(
      '1일 실험 앵커의 예상 수명이 지났습니다. 새로 저장해 주세요.',
    );
  }
  requireValue(
    hitType(r.hitType) &&
      typeof r.depthEnabled === 'boolean' &&
      typeof r.depthHitAllowed === 'boolean' &&
      r.geospatial === null,
  );
  const p = object(r.localPose);
  if (r.discoveryLocation !== undefined) {
    const d = object(r.discoveryLocation);
    requireValue(
      finite(d.latitude) &&
        d.latitude >= -90 &&
        d.latitude <= 90 &&
        finite(d.longitude) &&
        d.longitude >= -180 &&
        d.longitude <= 180 &&
        d.source === 'MAP_SELECTED' &&
        d.uncertaintyMeters === null,
    );
    date(d.capturedAt);
  }
  requireValue(p.frame === 'native-arcore-session');
  requireValue(
    Array.isArray(p.positionMeters) &&
      p.positionMeters.length === 3 &&
      p.positionMeters.every(finite),
  );
  requireValue(
    Array.isArray(p.rotationQuaternionXYZW) &&
      p.rotationQuaternionXYZW.length === 4 &&
      p.rotationQuaternionXYZW.every(finite),
  );
  requireValue(
    Math.abs(p.rotationQuaternionXYZW.reduce((sum, n) => sum + n * n, 0) - 1) <
      0.02,
  );
  const op = object(r.operation);
  requireValue(
    (op.type === 'HOST' || op.type === 'RESOLVE') &&
      nonempty(op.sessionId) &&
      nonempty(op.deviceLabel),
  );
  requireValue(finite(op.durationMs) && op.durationMs >= 0);
  date(op.recordedAt);
  if (r.restorationEstimate !== undefined) {
    const e = object(r.restorationEstimate);
    requireValue(
      op.type === 'RESOLVE' &&
        finite(e.horizontalOffsetMeters) &&
        e.horizontalOffsetMeters >= 0 &&
        finite(e.verticalOffsetMeters) &&
        hitType(e.referenceHitType) &&
        e.groundTruth === false,
    );
  }
  // A server response or copied JSON must never certify a physical cross-device test.
  r.crossDeviceVerified = false;
  return r as unknown as CloudRecord;
}
