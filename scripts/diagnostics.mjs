// Stable, compact diagnostics. Raw worker text is evidence, never a returned message.
const result=(stage,code,next_action,evidence='process')=>({stage,code,next_action,evidence});
export function diagnose({preflightRun,preflight,workerRun,workerParsed,workerManifest,outputValid,workerSuccess,status,acceptance=[],
  scopePassed=true,artifactsPassed=true}) {
  if(preflightRun.status!==0 || preflight?.status!=='READY') {
    const text=preflightRun.stderr||'';
    if(preflightRun.error?.code==='ETIMEDOUT') return result('preflight','PREFLIGHT_TIMEOUT','Check CLI cold-start time; no worker was dispatched.');
    if(/CLI was not found|agy executable was not found/i.test(text)) return result('preflight','CLI_NOT_FOUND','Install/configure the official CLI manually; do not retry the model.','wrapper_text');
    if(/proxy.*not reachable|connection.*refused|actively refused|No connection could be made/i.test(text)) return result('preflight','PROXY_UNREACHABLE','Check the configured proxy endpoint.','wrapper_text');
    if(/Invalid proxy URL/i.test(text)) return result('preflight','PROXY_INVALID','Correct proxy configuration manually.','wrapper_text');
    if(preflightRun.status===0) return result('preflight','PREFLIGHT_OUTPUT_INVALID','Inspect the preflight log; readiness could not be established.');
    return result('preflight','PREFLIGHT_FAILED','Inspect the preflight log; no worker was dispatched.');
  }
  if(workerRun.error?.code==='ETIMEDOUT') return result('worker','WORKER_TIMEOUT','Review partial changes before deciding whether a precise retry is appropriate.');
  if(workerRun.error) return result('worker_start','WORKER_PROCESS_ERROR','Inspect process-launch evidence; dispatch may be uncertain.');
  // Only inspect failure responses, not successful prose that happens to mention authentication.
  if(!workerSuccess) {
    if(workerRun.status===0 && workerParsed?.status==='SUCCESS' && !outputValid)
      return result('worker_output','WORKER_OUTPUT_INVALID','Inspect the saved output and schema errors.');
    const text=[workerRun.stderr||'', typeof workerParsed?.response==='string'?workerParsed.response:'',
      typeof workerParsed?.error==='string'?workerParsed.error:workerParsed?.error?.message||'',
      workerParsed?.structured_output?.status==='failed'?workerParsed.structured_output.summary||'':'',
      workerManifest?.status==='failed'?workerManifest.summary||'':''].join(' ');
    if(/unauthenticated|token exchange|authentication.*(required|failed)|sign.in required/i.test(text))
      return result('worker','AUTH_FAILED','Restore authentication manually; do not retry the model.','failure_text');
    if(/unknown model|model.*not.*available|model.*not.*found/i.test(text))
      return result('worker','MODEL_UNAVAILABLE','Check the requested model manually; do not switch models automatically.','failure_text');
    if(workerRun.status!==0) return result('worker','WORKER_EXIT_FAILED','Inspect worker logs and partial changes.');
    if(!outputValid) return result('worker_output','WORKER_OUTPUT_INVALID','Inspect the saved output and schema errors.');
    return result('worker','WORKER_REPORTED_FAILURE','Review the worker failure; no automatic retry.');
  }
  if(!outputValid) return result('worker_output','WORKER_OUTPUT_INVALID','Inspect the saved output and schema errors.');
  if(acceptance.some(r=>r.process_error==='ETIMEDOUT')) return result('acceptance','ACCEPTANCE_TIMEOUT','Inspect the timed-out test log; do not rerun the worker automatically.');
  if(!scopePassed) return result('verification','SCOPE_NOT_VERIFIED','Review scope/history evidence; do not accept changes automatically.');
  if(!artifactsPassed) return result('verification','ARTIFACT_NOT_VERIFIED','Inspect missing or invalid deliverables.');
  if(acceptance.some(r=>r.status==='FAIL')) return result('acceptance','ACCEPTANCE_FAILED','Inspect the failing acceptance command.');
  if(status==='NEEDS_REVIEW') return result('review','REVIEW_REQUIRED','Codex must inspect uncertainties and pre-existing edits.');
  if(status==='REJECTED') return result('verification','VERIFICATION_FAILED','Inspect the complete receipt.');
  return null;
}
export function diagnoseFatal(stage,error) {
  if(/Workspace busy/.test(error.message)) return result('coordination','WORKSPACE_BUSY','Inspect task-state; do not delete a live lock.');
  if(/Retry budget exhausted/.test(error.message)) return result('coordination','RETRY_EXHAUSTED','Codex must take over; do not reset retry records.');
  if(stage==='receipt') return result('receipt','RECEIPT_WRITE_FAILED','Inspect filesystem access and existing artifacts; the worker may already have completed.');
  return result(stage,'RUNNER_ERROR','Inspect the error; do not assume the worker was never dispatched.');
}
