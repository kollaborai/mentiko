# Auto-run resume recovery

Auto-run now records whether each resume attempt was accepted or failed. If an accepted resume cannot start because dispatch is unavailable or credentials cannot be rebuilt, the task shows an automatic pause with the reason and does not consume a retry. Use Retry task after addressing the cause. Confirmed failures before acceptance continue to count toward the three-retry limit.
