-- Records who paid a Jing Wu Foundation Reunion (Beijing 2027) deposit and, in
-- particular, their acceptance of the non-refundable deposit terms. Reunion
-- checkout is a guest flow, so there is no user_id to hang this off of; the
-- provider order id is what ties a row to its Stripe session / PayPal order.
CREATE TABLE reunion_deposits (
  id SERIAL PRIMARY KEY,
  student_name        VARCHAR(255) NULL,
  student_email       VARCHAR(255) NOT NULL,
  student_phone       VARCHAR(50)  NULL,
  -- Consent: the exact text shown is stored alongside the flag so a later
  -- change to the wording can't retroactively alter what someone agreed to.
  terms_accepted      BOOLEAN      NOT NULL DEFAULT FALSE,
  terms_accepted_at   TIMESTAMP    NOT NULL,
  terms_version       VARCHAR(20)  NOT NULL,
  terms_text          TEXT         NOT NULL,
  provider            VARCHAR(20)  NOT NULL,
  provider_order_id   VARCHAR(255) NOT NULL,
  amount_usd          INTEGER      NOT NULL,
  status              VARCHAR(50)  NOT NULL DEFAULT 'pending',
  created_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT reunion_deposits_provider_order_unique UNIQUE (provider, provider_order_id)
);

CREATE INDEX idx_reunion_deposits_email ON reunion_deposits(student_email);
CREATE INDEX idx_reunion_deposits_status ON reunion_deposits(status);
