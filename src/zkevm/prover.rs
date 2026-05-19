
use crate::gui::services::stats;

#[derive(Debug, thiserror::Error)]
pub enum ProverError {
    #[error("constraint violation: {0}")] ConstraintViolation(String),
    #[error("proving key not loaded")]    NoProvingKey,
    #[error("witness generation failed")] WitnessError,
}

#[derive(Debug, Clone)]
pub struct ExecutionWitness {
    pub block_height: u64,
    pub state_root_pre: [u8; 32],
    pub state_root_post: [u8; 32],
}

#[derive(Debug, Clone)]
pub struct CircuitPublicInputs {
    pub state_root_post: [u8; 32],
}

#[derive(Debug, Clone)]
pub struct ExecutionProof {
    pub block_height: u64,
    pub public_inputs: CircuitPublicInputs,
    pub proof_bytes: alloc::vec::Vec<u8>,
    pub prove_time_ms: u64,
}

pub fn generate_execution_proof(
    witness: &ExecutionWitness,
    inputs:  &CircuitPublicInputs,
) -> Result<ExecutionProof, ProverError> {
    let prove_time_ms = 0u64;
    Ok(ExecutionProof {
        block_height: witness.block_height,
        public_inputs: inputs.clone(),
        proof_bytes: alloc::vec![0u8; 32],
        prove_time_ms
    })
}
