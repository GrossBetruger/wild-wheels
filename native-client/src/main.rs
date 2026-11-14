fn main() {
    if let Err(error) = wild_wheels_native::run() {
        eprintln!("Wild Wheels: {error}");
        std::process::exit(1);
    }
}
