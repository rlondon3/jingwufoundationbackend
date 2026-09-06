/**
 * ReunionDepositStore handles reunion deposit records, including the payer's
 * acceptance of the non-refundable deposit terms.
 */
class ReunionDepositStore {
	constructor(pool) {
		this.pool = pool;
	}

	/**
	 * Record a deposit attempt plus the terms the payer accepted. Called when
	 * checkout is created; the webhook later flips status to 'completed'.
	 * termsAcceptedAt is stamped server-side, not taken from the client.
	 */
	async create(depositData) {
		const {
			studentName,
			studentEmail,
			studentPhone,
			termsAccepted,
			termsVersion,
			termsText,
			provider,
			providerOrderId,
			amountUsd,
			couponCode = null,
			status = 'pending',
		} = depositData;

		const query = `
      INSERT INTO reunion_deposits (
        student_name, student_email, student_phone,
        terms_accepted, terms_accepted_at, terms_version, terms_text,
        provider, provider_order_id, amount_usd, coupon_code, status,
        created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, NOW(), $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
      RETURNING *
    `;

		const client = await this.pool.connect();
		try {
			const result = await client.query(query, [
				studentName || null,
				studentEmail,
				studentPhone || null,
				termsAccepted,
				termsVersion,
				termsText,
				provider,
				providerOrderId,
				amountUsd,
				couponCode,
				status,
			]);
			return result.rows[0];
		} catch (error) {
			throw new Error(`Could not create reunion deposit: ${error}`);
		} finally {
			client.release();
		}
	}

	/**
	 * Mark a deposit paid once the provider webhook confirms capture.
	 *
	 * amountUsd is optional and overwrites the amount recorded at checkout: a
	 * coupon means the pending row's amount is only what we expected to charge,
	 * while the webhook carries what the payer was actually charged. Left out,
	 * the existing amount stands.
	 */
	async markCompleted(provider, providerOrderId, { amountUsd } = {}) {
		const query = `
      UPDATE reunion_deposits
      SET status = 'completed',
          amount_usd = COALESCE($3, amount_usd),
          updated_at = NOW()
      WHERE provider = $1 AND provider_order_id = $2
      RETURNING *
    `;

		const client = await this.pool.connect();
		try {
			const result = await client.query(query, [
				provider,
				providerOrderId,
				amountUsd === undefined ? null : amountUsd,
			]);
			return result.rows[0];
		} catch (error) {
			throw new Error(`Could not update reunion deposit: ${error}`);
		} finally {
			client.release();
		}
	}

	/**
	 * All deposits, newest first — for admin reporting on who has reserved.
	 */
	async index() {
		const query = `
      SELECT * FROM reunion_deposits
      ORDER BY created_at DESC
    `;

		const client = await this.pool.connect();
		try {
			const result = await client.query(query);
			return result.rows;
		} catch (error) {
			throw new Error(`Could not get reunion deposits: ${error}`);
		} finally {
			client.release();
		}
	}
}

module.exports = { ReunionDepositStore };
