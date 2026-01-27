from backend.config.thresholds import IDEAL_RESOLUTION_DAYS

def calculate_credibility(metrics):
    assigned = metrics.get("total_assigned", 0)
    completed = metrics.get("granted", 0)
    completion_ratio = completed / assigned if assigned > 0 else 0
    resolution = min(1, IDEAL_RESOLUTION_DAYS / metrics["avg_resolution"]) if metrics["avg_resolution"] else 1
    long_pending = 1 - (metrics["long_pending"] / assigned) if assigned else 1
    reopen = 1 - metrics["reopen_rate"]

    score = (
        0.30 * completion_ratio +
        0.25 * resolution +
        0.20 * long_pending +
        0.15 * reopen +
        0.10 * (1 if assigned > 0 else 0)
    ) * 100

    if score >= 80:
        label = "High"
    elif score >= 60:
        label = "Moderate"
    elif score >= 40:
        label = "Low"
    else:
        label = "Critical"

    return {"score": round(score,1), "label": label}
