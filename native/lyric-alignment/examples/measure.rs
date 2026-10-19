use anyhow::{Context, Result};
use serde_json::json;
use std::{
    collections::HashSet,
    fs::File,
    io::Write,
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};
use sysinfo::{Pid, ProcessesToUpdate, System};

/// 测量独立任务耗时及进程树峰值工作集，结果保留用于文本和范围一致性比较
fn main() -> Result<()> {
    let mut args = std::env::args_os().skip(1);
    let executable = args.next().context("缺少工作进程路径")?;
    let input = std::fs::read(args.next().context("缺少输入文件")?)?;
    let output = args.next().context("缺少结果文件")?;
    let start = Instant::now();
    let mut child = Command::new(executable)
        .args(args)
        .env("RAYON_NUM_THREADS", "2")
        .env("TOKENIZERS_PARALLELISM", "false")
        .stdin(Stdio::piped())
        .stdout(File::create(&output)?)
        .stderr(File::create(
            std::path::Path::new(&output).with_extension("stderr"),
        )?)
        .spawn()?;
    let root = Pid::from_u32(child.id());
    let mut stdin = child.stdin.take().context("缺少标准输入")?;
    let writer = thread::spawn(move || {
        let result = stdin.write_all(&input);
        drop(stdin);
        result
    });
    let waiter = thread::spawn(move || {
        let status = child.wait()?;
        let elapsed = start.elapsed();
        #[cfg(windows)]
        let peak = {
            use std::os::windows::io::AsRawHandle;
            use windows_sys::Win32::System::ProcessStatus::{
                K32GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS,
            };
            // 子进程句柄在 Child 释放前有效，系统峰值可覆盖短于采样周期的任务
            let mut counters: PROCESS_MEMORY_COUNTERS = unsafe { std::mem::zeroed() };
            let success = unsafe {
                K32GetProcessMemoryInfo(
                    child.as_raw_handle(),
                    &mut counters,
                    std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32,
                )
            };
            if success != 0 {
                counters.PeakWorkingSetSize as u64
            } else {
                0
            }
        };
        #[cfg(not(windows))]
        let peak = 0;
        Ok::<_, std::io::Error>((status, elapsed, peak))
    });
    let mut system = System::new();
    let mut peak = 0;
    while !waiter.is_finished() {
        system.refresh_processes(ProcessesToUpdate::All, true);
        let mut pids = HashSet::from([root]);
        loop {
            let count = pids.len();
            for (pid, process) in system.processes() {
                if process.parent().is_some_and(|p| pids.contains(&p)) {
                    pids.insert(*pid);
                }
            }
            if pids.len() == count {
                break;
            }
        }
        let memory: u64 = pids
            .iter()
            .filter_map(|pid| system.process(*pid))
            .map(|p| p.memory())
            .sum();
        peak = peak.max(memory);
        thread::sleep(Duration::from_millis(20));
    }
    let (status, elapsed, system_peak) = waiter.join().expect("进程等待线程完成")?;
    writer.join().expect("输入写入线程完成")?;
    println!(
        "{}",
        json!({"elapsedMs":elapsed.as_secs_f64()*1000.0,"peakWorkingSetBytes":peak.max(system_peak),"exitCode":status.code()})
    );
    anyhow::ensure!(status.success(), "工作进程失败，诊断见结果旁的 stderr 文件");
    Ok(())
}
