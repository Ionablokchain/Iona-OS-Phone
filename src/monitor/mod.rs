
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UserActivity {
    Low,
    High,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HardwareMetrics {
    pub power_draw: u32,
    pub threshold: u32,
    pub user_activity: UserActivity,
}

pub fn get_hardware_metrics() -> HardwareMetrics {
    HardwareMetrics {
        power_draw: 5,
        threshold: 10,
        user_activity: UserActivity::Low,
    }
}
