export type Vector3Tuple = [number, number, number];

export interface AttachmentElementFrame {
    from: Vector3Tuple;
    to: Vector3Tuple;
    rotationOrigin: Vector3Tuple;
    rotation: Vector3Tuple;
}

export interface StepParentFrame {
    from: Vector3Tuple;
    rotation: Vector3Tuple;
}

type QuaternionTuple = [number, number, number, number];

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const CLEAN_EPSILON = 1e-7;

function cleanNumber(value: number): number {
    if (Math.abs(value) < CLEAN_EPSILON) return 0;
    const rounded = Math.round(value * 1e6) / 1e6;
    return Object.is(rounded, -0) ? 0 : rounded;
}

function eulerXYZToQuaternion(rotation: Vector3Tuple): QuaternionTuple {
    const x = rotation[0] * DEG_TO_RAD / 2;
    const y = rotation[1] * DEG_TO_RAD / 2;
    const z = rotation[2] * DEG_TO_RAD / 2;
    const c1 = Math.cos(x), c2 = Math.cos(y), c3 = Math.cos(z);
    const s1 = Math.sin(x), s2 = Math.sin(y), s3 = Math.sin(z);

    return [
        s1 * c2 * c3 + c1 * s2 * s3,
        c1 * s2 * c3 - s1 * c2 * s3,
        c1 * c2 * s3 + s1 * s2 * c3,
        c1 * c2 * c3 - s1 * s2 * s3,
    ];
}

function multiplyQuaternion(a: QuaternionTuple, b: QuaternionTuple): QuaternionTuple {
    const [ax, ay, az, aw] = a;
    const [bx, by, bz, bw] = b;
    return [
        ax * bw + aw * bx + ay * bz - az * by,
        ay * bw + aw * by + az * bx - ax * bz,
        az * bw + aw * bz + ax * by - ay * bx,
        aw * bw - ax * bx - ay * by - az * bz,
    ];
}

function invertUnitQuaternion(q: QuaternionTuple): QuaternionTuple {
    return [-q[0], -q[1], -q[2], q[3]];
}

function quaternionToEulerXYZ(q: QuaternionTuple): Vector3Tuple {
    const [x, y, z, w] = q;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    const m11 = 1 - (yy + zz);
    const m12 = xy - wz;
    const m13 = xz + wy;
    const m22 = 1 - (xx + zz);
    const m23 = yz - wx;
    const m32 = yz + wx;
    const m33 = 1 - (xx + yy);
    const clampedM13 = Math.max(-1, Math.min(1, m13));

    let resultX: number;
    let resultZ: number;
    const resultY = Math.asin(clampedM13);
    if (Math.abs(clampedM13) < 0.9999999) {
        resultX = Math.atan2(-m23, m33);
        resultZ = Math.atan2(-m12, m11);
    } else {
        resultX = Math.atan2(m32, m22);
        resultZ = 0;
    }

    return [
        cleanNumber(resultX * RAD_TO_DEG),
        cleanNumber(resultY * RAD_TO_DEG),
        cleanNumber(resultZ * RAD_TO_DEG),
    ];
}

/** Composes a root-to-leaf chain of XYZ Euler rotations. */
export function composeEulerXYZ(rotations: Vector3Tuple[]): Vector3Tuple {
    let result: QuaternionTuple = [0, 0, 0, 1];
    for (const rotation of rotations) {
        result = multiplyQuaternion(result, eulerXYZToQuaternion(rotation));
    }
    return quaternionToEulerXYZ(result);
}

/** Converts a model-space XYZ rotation into a parent's local rotation. */
export function relativeEulerXYZ(
    rotation: Vector3Tuple,
    parentRotation: Vector3Tuple
): Vector3Tuple {
    const inverseParentRotation = invertUnitQuaternion(eulerXYZToQuaternion(parentRotation));
    return quaternionToEulerXYZ(multiplyQuaternion(
        inverseParentRotation,
        eulerXYZToQuaternion(rotation)
    ));
}

function subtractVector(a: Vector3Tuple, b: Vector3Tuple): Vector3Tuple {
    return [
        cleanNumber(a[0] - b[0]),
        cleanNumber(a[1] - b[1]),
        cleanNumber(a[2] - b[2]),
    ];
}

/**
 * Converts a model-space attachment root transform into the local space of a
 * VS step-parent socket. Vintage Story uses XYZ Euler rotations for this format.
 */
export function rebaseAttachmentRoot(
    root: AttachmentElementFrame,
    socket: StepParentFrame
): AttachmentElementFrame {
    // VS serializes a child's coordinates relative to its parent's `from` by
    // subtraction. The inherited rotation is handled separately below.
    return {
        from: subtractVector(root.from, socket.from),
        to: subtractVector(root.to, socket.from),
        rotationOrigin: subtractVector(root.rotationOrigin, socket.from),
        rotation: relativeEulerXYZ(root.rotation, socket.rotation),
    };
}
