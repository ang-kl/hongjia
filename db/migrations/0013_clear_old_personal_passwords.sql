-- The owner, 20 November 2026: clear the old personal passwords. Sign-in has used one family password
-- (the HONGJIA_FAMILY_PASSWORD setting) since the owner's decision to drop personal passwords and
-- enrolment; nothing reads this table any more. Its rows were hashes only; they are removed for good.
DELETE FROM credentials;
