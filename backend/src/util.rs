use std::time::{SystemTime, UNIX_EPOCH};

/// 当前 Unix 秒级时间戳。
pub fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

/// 计算字节内容的 SHA-256 十六进制摘要。
pub fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

/// 生成 `len` 字节密码学安全随机数的十六进制字符串。
pub fn random_hex(len: usize) -> String {
    use rand::RngCore;
    let mut bytes = vec![0u8; len];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}
