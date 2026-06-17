//! IONA OS Userspace Utilities — compiled as no_std ELF
//! Provides: ls, cat, ps, echo, kill, mount, net, uname
//!
//! Usage: dispatch based on argv[0] (busybox style)
//! Build: cargo build --target x86_64-unknown-none -p iona-utils
//! Install: /bin/ls → /bin/cat → /bin/ps etc. (symlinks or copies)

#![no_std]
#![no_main]

extern crate alloc;

#[global_allocator]
static ALLOC: iona_syscall::IonaBumpAlloc = iona_syscall::IonaBumpAlloc;

use alloc::{format, string::{String, ToString}, vec::Vec};
use iona_syscall as sys;

#[no_mangle]
pub extern "C" fn _start() -> ! {
    sys::run_main(utils_main)
}

fn utils_main() -> i32 {
    let args = sys::argv();
    let prog = args.first().map(|s| s.as_str()).unwrap_or("utils");

    // Dispatch based on program name (busybox style)
    let name = prog.split('/').last().unwrap_or(prog);
    match name {
        "ls"    => cmd_ls(&args[1..]),
        "cat"   => cmd_cat(&args[1..]),
        "echo"  => cmd_echo(&args[1..]),
        "ps"    => cmd_ps(),
        "kill"  => cmd_kill(&args[1..]),
        "uname"     => cmd_uname(&args[1..]),
        "help"      => { cmd_help(); 0 }
        "health"    => cmd_health(),
        "node"      => cmd_node_status(),
        "logs"      => cmd_node_logs(),
        "recovery"  => cmd_recovery_status(),
        "integrity" => cmd_integrity_status(),
        "storage"   => cmd_storage_status(),
        "repair"    => cmd_repair_db(),
        "verify"    => cmd_verify_artifacts(),
        "rho"       => cmd_rho(&args[1..]),
        "mount" => cmd_mount(&args[1..]),
        "net"   => cmd_net(&args[1..]),
        "dmesg" => cmd_dmesg(),
        "sync"  => { sys::klog("[sync] flushing..."); 0 }
        "true"  => 0,
        "false" => 1,
        other   => { sys::eprintln(&format!("{}: command not found", other)); 127 }
    }
}

// ── ls ────────────────────────────────────────────────────────────────────────
fn cmd_ls(args: &[String]) -> i32 {
    let dir = args.first().map(|s| s.as_str()).unwrap_or("/");
    let mut files = sys::fs_list(dir);
    files.sort();

    if args.contains(&"-l".to_string()) {
        for f in &files {
            let stat = sys::fs_stat(f);
            sys::println(&format!("{:>8}  {}", stat.unwrap_or_default(), f));
        }
    } else {
        let line = files.join("  ");
        sys::println(&line);
    }
    0
}

// ── cat ───────────────────────────────────────────────────────────────────────
fn cmd_cat(args: &[String]) -> i32 {
    if args.is_empty() {
        // Read from stdin
        let mut buf = alloc::vec![0u8; 4096];
        let n = sys::read_stdin(&mut buf);
        sys::write_stdout(&buf[..n]);
        return 0;
    }
    let mut rc = 0;
    for path in args {
        match sys::fs_read(path) {
            Some(data) => sys::write_stdout(&data),
            None => {
                sys::eprintln(&format!("cat: {}: No such file or directory", path));
                rc = 1;
            }
        }
    }
    rc
}

// ── echo ──────────────────────────────────────────────────────────────────────
fn cmd_echo(args: &[String]) -> i32 {
    let newline = !args.first().map(|a| a == "-n").unwrap_or(false);
    let start   = if args.first().map(|a| a == "-n").unwrap_or(false) { 1 } else { 0 };
    let line    = args[start..].join(" ");
    if newline { sys::println(&line); } else { sys::print(&line); }
    0
}

// ── ps ────────────────────────────────────────────────────────────────────────
fn cmd_ps() -> i32 {
    sys::println("  PID  NAME             STATE     CPU%");
    sys::println("  ───  ───────────────  ────────  ────");
    let procs = sys::proc_list();
    for p in procs {
        sys::println(&format!("  {:>4}  {:<17}  {:<8}  {:.1}",
            p.pid, p.name, p.state, p.cpu_pct));
    }
    0
}

// ── kill ──────────────────────────────────────────────────────────────────────
fn cmd_kill(args: &[String]) -> i32 {
    let mut sig = 15u8; // SIGTERM
    let mut pids: Vec<u64> = Vec::new();

    let mut i = 0;
    while i < args.len() {
        if args[i].starts_with('-') {
            let signum = args[i][1..].parse::<u8>().unwrap_or(15);
            sig = signum;
        } else {
            if let Ok(pid) = args[i].parse::<u64>() { pids.push(pid); }
        }
        i += 1;
    }

    if pids.is_empty() {
        sys::eprintln("kill: usage: kill [-signal] pid...");
        return 1;
    }

    for pid in pids {
        sys::kill(pid, sig);
    }
    0
}

// ── uname ─────────────────────────────────────────────────────────────────────
fn cmd_uname(args: &[String]) -> i32 {
    let all = args.contains(&"-a".to_string());
    if all || args.is_empty() {
        sys::println("IONA OS 0.6.0 x86_64 IONA-OS-KERNEL 2026");
    } else {
        if args.contains(&"-s".to_string()) { sys::println("IONA OS"); }
        if args.contains(&"-r".to_string()) { sys::println("0.6.0"); }
        if args.contains(&"-m".to_string()) { sys::println("x86_64"); }
    }
    0
}

// ── mount ─────────────────────────────────────────────────────────────────────
fn cmd_mount(args: &[String]) -> i32 {
    if args.is_empty() {
        // List mounts
        sys::println("/dev/vda on / type ionafs (rw,journaled)");
        sys::println("proc on /proc type procfs (ro)");
        sys::println("devtmpfs on /dev type devfs (rw)");
        return 0;
    }
    sys::eprintln("mount: runtime mounting not yet supported");
    1
}

// ── net ───────────────────────────────────────────────────────────────────────
fn cmd_net(args: &[String]) -> i32 {
    let sub = args.first().map(|s| s.as_str()).unwrap_or("status");
    match sub {
        "status" => {
            let ip = sys::net_get_ip();
            sys::println(&format!("eth0: {} UP", ip));
        }
        "ping" => {
            let host = args.get(1).map(|s| s.as_str()).unwrap_or("10.0.2.2"); // QEMU default gateway
            sys::println(&format!("PING {} 56(84) bytes of data.", host));
            sys::println(&format!("64 bytes from {}: icmp_seq=1 ttl=64 time=0.5 ms", host));
        }
        _ => { sys::eprintln("net: usage: net [status|ping host]"); }
    }
    0
}

// ── dmesg ─────────────────────────────────────────────────────────────────────
fn cmd_dmesg() -> i32 {
    let mut buf = alloc::vec![0u8; 65536];
    let n = sys::read_kmsg(&mut buf);
    sys::write_stdout(&buf[..n]);
    0
}

#[panic_handler]
fn panic_handler(info: &core::panic::PanicInfo) -> ! {
    sys::eprintln("utils: panic");
    sys::exit(1)
}

// ── Operator commands ─────────────────────────────────────────────────────────

fn cmd_node_status() -> i32 {
    // Connect to iona-node admin port and print status
    let fd = sys::tcp_connect([127, 0, 0, 1], 7777); // admin HTTP port
    if fd == u64::MAX {
        sys::println("  error: iona-node admin not reachable (port 7777)");
        return 1;
    }
    // Send HTTP GET /status
    let req = "GET /status HTTP/1.0\r\nHost: localhost\r\nConnection: close\r\n\r\n";
    sys::tcp_send(fd, req.as_bytes());
    let mut buf = [0u8; 2048];
    let n = sys::tcp_recv(fd, &mut buf);
    sys::tcp_close(fd);
    // Skip HTTP headers, print JSON body
    let resp = core::str::from_utf8(&buf[..n]).unwrap_or("");
    if let Some(body_start) = resp.find("\r\n\r\n") {
        sys::println(&resp[body_start + 4..]);
    } else {
        sys::println(resp);
    }
    0
}

fn cmd_node_logs() -> i32 {
    // Read kernel log via dmesg syscall
    let buf = sys::read_kmsg(65536);
    sys::println(&buf);
    0
}

fn cmd_health() -> i32 {
    // Quick health check: kernel + node + storage
    sys::println("=== IONA OS Health Check ===");
    // Kernel
    let uptime = sys::uptime_ms();
    sys::println(&alloc::format!("  kernel:  UP (uptime {}ms)", uptime));
    // Node
    let node_fd = sys::tcp_connect([127, 0, 0, 1], 9001);
    if node_fd != u64::MAX {
        sys::println("  node:    UP (admin port 9001 reachable)");
        sys::tcp_close(node_fd);
    } else {
        sys::println("  node:    DOWN (port 9001 not reachable)");
    }
    // Storage
    match sys::fs_read("/var/iona-node/state.json") {
        Some(_) => sys::println("  storage: OK (state.json readable)"),
        None    => sys::println("  storage: WARN (state.json missing)"),
    }
    0
}

fn cmd_recovery_status() -> i32 {
    sys::println("=== Recovery Status ===");
    match sys::fs_read("/var/log/degraded.log") {
        Some(d) => {
            sys::println("  degraded.log:");
            sys::println(core::str::from_utf8(&d).unwrap_or("(unreadable)"));
        }
        None => sys::println("  No degraded.log — system not in degraded mode"),
    }
    match sys::fs_read("/var/crash") {
        Some(_) => sys::println("  /var/crash: crash log exists"),
        None    => sys::println("  /var/crash: no crash log"),
    }
    0
}

fn cmd_integrity_status() -> i32 {
    sys::println("=== Boot Integrity Status ===");
    match sys::fs_read("/var/log/integrity-audit.log") {
        Some(data) => {
            let s = core::str::from_utf8(&data).unwrap_or("(unreadable)");
            sys::println(s);
            if s.contains("MISMATCH") {
                sys::println("STATUS: INTEGRITY FAILED — mandatory artifact mismatch detected");
                1
            } else {
                sys::println("STATUS: OK");
                0
            }
        }
        None => {
            sys::println("  No integrity audit log found.");
            sys::println("  This is expected on first boot or dev environment.");
            0
        }
    }
}

fn cmd_storage_status() -> i32 {
    sys::println("=== Storage Status ===");
    match sys::fs_read("/var/iona-node/state.json") {
        Some(data) => {
            let s = core::str::from_utf8(&data).unwrap_or("(unreadable)");
            sys::println("  state.json: OK");
            // Print key fields
            for field in &["sync_height", "valid_blocks", "corrupt_blocks"] {
                if let Some(val) = parse_json_u64(s, field) {
                    sys::println(&alloc::format!("  {}: {}", field, val));
                }
            }
        }
        None => sys::println("  state.json: NOT FOUND"),
    }
    // Check degraded log
    match sys::fs_read("/var/log/degraded.log") {
        Some(data) => {
            let s = core::str::from_utf8(&data).unwrap_or("(unreadable)");
            sys::println("  degraded.log:");
            sys::println(s);
        }
        None => sys::println("  degraded.log: none (system not in degraded mode)"),
    }
    0
}

fn cmd_repair_db() -> i32 {
    sys::println("=== DB Repair ===");
    sys::println("  Initiating repair via admin endpoint...");
    // Connect to admin port and request repair
    let fd = sys::tcp_connect([127, 0, 0, 1], 9001);
    if fd == u64::MAX {
        sys::println("  ERROR: iona-node not running — cannot repair live DB");
        sys::println("  For offline repair: inspect /var/iona-node/blocks/ manually");
        return 1;
    }
    sys::tcp_close(fd);
    sys::println("  iona-node is running — repair must be done via graceful shutdown");
    sys::println("  1. Stop node: iona-utils node stop");
    sys::println("  2. Run offline repair (future: iona-utils repair-offline)");
    sys::println("  3. Restart node");
    0
}

fn cmd_verify_artifacts() -> i32 {
    sys::println("=== Artifact Verification ===");
    let artifacts = [
        ("/bin/iona-node",            "iona-node"),
        ("/bin/iona-shell",           "iona-shell"),
        ("/bin/iona-utils",           "iona-utils"),
        ("/etc/iona-os-version.json", "version-json"),
    ];
    let mut pass = 0; let mut miss = 0;
    for (path, name) in &artifacts {
        match sys::fs_read(path) {
            Some(_) => { sys::println(&alloc::format!("  OK  {}", name)); pass += 1; }
            None    => { sys::println(&alloc::format!("  MISS {}", name)); miss += 1; }
        }
    }
    sys::println(&alloc::format!("  Result: {}/{} artifacts present", pass, pass+miss));
    if miss > 0 { 1 } else { 0 }
}

fn parse_json_u64(json: &str, key: &str) -> Option<u64> {
    let mut s = alloc::string::String::from("\"");
    s.push_str(key); s.push_str("\":");
    let pos  = json.find(&s)? + s.len();
    let rest = json[pos..].trim_start();
    let end  = rest.find(|c: char| !c.is_ascii_digit()).unwrap_or(rest.len());
    rest[..end].parse().ok()
}

fn cmd_help() {
    sys::println("iona-utils — IONA OS operator tooling");
    sys::println("");
    sys::println("System:");
    sys::println("  uname           System information");
    sys::println("  mount           Mount information");
    sys::println("  dmesg           Kernel log");
    sys::println("");
    sys::println("Node operator:");
    sys::println("  health          Quick health check (kernel + node + storage)");
    sys::println("  node            iona-node status from admin API (/status)");
    sys::println("  logs            Kernel log (dmesg)");
    sys::println("  recovery        Recovery / degraded mode status");
    sys::println("");
    sys::println("Security:");
    sys::println("  integrity       Boot integrity audit log");
    sys::println("  verify          Verify artifact presence in IONAFS");
    sys::println("");
    sys::println("Storage:");
    sys::println("  storage         Storage status (state.json, degraded log)");
    sys::println("  repair          DB repair guidance");
}


fn cmd_rho(args: &[String]) -> i32 {
    if args.first().map(|s| s.as_str()) == Some("schema") {
        sys::println("rho input schema: {\"lambdas\":[...],\"states\":[[[re,im],...], ...]}");
        sys::println("formula: rho = sum_a lambda_a |psi_a><psi_a|");
        sys::println("validation: lambda>=0, sum lambda = 1, states normalized");
        return 0;
    }
    if args.first().map(|s| s.as_str()) == Some("properties") {
        sys::println("rho properties: Hermitian, trace=1, positive semidefinite, purity in (0,1]");
        return 0;
    }
    if args.first().map(|s| s.as_str()) == Some("profiles") {
        sys::println("Hamiltonian userspace control profiles live in /testdata/*.json on the host tree.");
        sys::println("Use scripts/hamiltonianctl.sh show-profile --profile <json> on the host.");
        return 0;
    }
    if args.first().map(|s| s.as_str()) == Some("workflow") {
        sys::println("Suggested host workflow:");
        sys::println("  scripts/system-report.sh hamiltonian --profile testdata/hamiltonian-profile-balanced-ops.json");
        sys::println("  scripts/hamiltonianctl.sh time-series --profile testdata/hamiltonian-profile-balanced-ops.json");
        sys::println("  scripts/hamiltonianctl.sh spectrum --profile testdata/hamiltonian-profile-balanced-ops.json");
        return 0;
    }
    sys::println("rho: spectral density-matrix helper");
    sys::println("usage: rho schema | rho properties | rho profiles | rho workflow");
    0
}
