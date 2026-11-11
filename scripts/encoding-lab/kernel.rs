// Benchmark-only ABI. All memory is owned by this module; callers copy bounded buffers.
const MAX: usize = 262144;
static mut VALUES: [f64; MAX] = [0.0; MAX];
static mut SCALES: [f64; MAX] = [1.0; MAX];
static mut PACKED: [i32; MAX] = [0; MAX];

#[no_mangle]
pub extern "C" fn values_ptr() -> *mut f64 { core::ptr::addr_of_mut!(VALUES).cast() }
#[no_mangle]
pub extern "C" fn scales_ptr() -> *mut f64 { core::ptr::addr_of_mut!(SCALES).cast() }
#[no_mangle]
pub extern "C" fn packed_ptr() -> *mut i32 { core::ptr::addr_of_mut!(PACKED).cast() }
#[no_mangle]
pub extern "C" fn transform(n: usize, decode: bool) -> u32 {
    if n > MAX { return 0; }
    // n is checked against every fixed allocation before pointer arithmetic.
    unsafe {
        let values = values_ptr(); let scales = scales_ptr(); let packed = packed_ptr();
        for i in 0..n {
            let scale = *scales.add(i);
            if !scale.is_finite() || scale <= 0.0 { return 0; }
            if decode { *values.add(i) = *packed.add(i) as f64 / scale; continue; }
            // Match JavaScript Math.round, including its negative-half convention.
            let scaled = *values.add(i) * scale;
            let floor = scaled.floor();
            let value = match scaled - floor < 0.5 { true => floor, false => floor + 1.0 };
            if !value.is_finite() || value < i32::MIN as f64 || value > i32::MAX as f64 { return 0; }
            *packed.add(i) = value as i32;
        }
    }
    1
}
