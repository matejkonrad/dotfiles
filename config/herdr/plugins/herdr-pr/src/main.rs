mod action;
mod board;
mod daemon;
mod fixloop;
mod forge;
mod herdr;
mod ipc;
mod model;
mod proc;
mod stack;
mod store;

const USAGE: &str =
    "usage: herdr-pr daemon [--foreground] | action <board|fix|auto|seen|refresh> | board | link";

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    match args.as_slice() {
        ["daemon"] => daemon::start(),
        ["daemon", "--foreground"] => daemon::run_foreground(),
        ["action", name] => action::run(name),
        ["board"] => board::run(),
        ["link"] => action::link(),
        _ => {
            eprintln!("{USAGE}");
            std::process::exit(2);
        }
    }
}
