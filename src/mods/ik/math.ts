
/**
 * Vector math utilities
 */
export function vec3Sub(a: [number, number, number], b: [number, number, number]): [number, number, number] {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function vec3Add(a: [number, number, number], b: [number, number, number]): [number, number, number] {
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function vec3Length(v: [number, number, number]): number {
    return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

export function vec3Normalize(v: [number, number, number]): [number, number, number] {
    const len = vec3Length(v);
    if (len < 0.0001) return [0, 0, 0];
    return [v[0] / len, v[1] / len, v[2] / len];
}

export function vec3Dot(a: [number, number, number], b: [number, number, number]): number {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function vec3Cross(a: [number, number, number], b: [number, number, number]): [number, number, number] {
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0]
    ];
}

/**
 * Convert Euler angles (degrees) to rotation matrix
 */
export function eulerToRotationMatrix(euler: [number, number, number]): number[][] {
    const [rx, ry, rz] = euler.map(deg => deg * Math.PI / 180);

    const cx = Math.cos(rx), sx = Math.sin(rx);
    const cy = Math.cos(ry), sy = Math.sin(ry);
    const cz = Math.cos(rz), sz = Math.sin(rz);

    return [
        [cy * cz, -cy * sz, sy],
        [cx * sz + sx * sy * cz, cx * cz - sx * sy * sz, -sx * cy],
        [sx * sz - cx * sy * cz, sx * cz + cx * sy * sz, cx * cy]
    ];
}

/**
 * Apply rotation to a vector
 */
export function rotateVector(v: [number, number, number], euler: [number, number, number]): [number, number, number] {
    const m = eulerToRotationMatrix(euler);
    return [
        m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
        m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
        m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]
    ];
}

/**
 * Calculate rotation needed to align one vector to another
 * Returns Euler angles in degrees
 */
export function alignVectors(from: [number, number, number], to: [number, number, number]): [number, number, number] {
    const fromNorm = vec3Normalize(from);
    const toNorm = vec3Normalize(to);

    const dot = vec3Dot(fromNorm, toNorm);
    
    if (Math.abs(dot - 1) < 0.0001) {
        return [0, 0, 0];
    }
    
    if (Math.abs(dot + 1) < 0.0001) {
        
        const perp = Math.abs(fromNorm[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
        const axis = vec3Normalize(vec3Cross(fromNorm, perp));
        const angle = Math.PI;
        
        return [0, angle * 180 / Math.PI, 0];
    }
    
    const axis = vec3Normalize(vec3Cross(fromNorm, toNorm));
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
    
    const angleDeg = angle * 180 / Math.PI;
    
    if (Math.abs(axis[1]) > 0.9) {
        
        return [0, angleDeg * (axis[1] > 0 ? 1 : -1), 0];
    } else if (Math.abs(axis[0]) > 0.9) {
        
        return [angleDeg * (axis[0] > 0 ? 1 : -1), 0, 0];
    } else {
        
        return [0, 0, angleDeg * (axis[2] > 0 ? 1 : -1)];
    }
}