# Allow delayed recovery while preserving purchased deadlines

Mend uses free backend hosting with durable PostgreSQL work records and scheduled recovery invocations, accepting that platform interruptions can delay investigation by several minutes. The purchased two-minute delivery deadline does not move; overdue orders stay visible, and a refund still requires confirmed stopped execution and a final result check. This trades prompt recovery after infrastructure failures for free hosting without weakening payment or refund evidence requirements.
