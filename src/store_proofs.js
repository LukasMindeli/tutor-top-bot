const { supabase } = require("./supabase");

function isoNow() { return new Date().toISOString(); }

async function createProof(payload) {
  const { data, error } = await supabase
    .from("payment_proofs")
    .insert(payload)
    .select("id")
    .single();

  if (error) {
    console.error("createProof error:", error.message);
    return null;
  }
  return data?.id || null;
}

async function getProofById(id) {
  const { data, error } = await supabase
    .from("payment_proofs")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("getProofById error:", error.message);
    return null;
  }
  return data || null;
}

async function setProofStatus(id, status, reviewerId, note) {
  const { data, error } = await supabase
    .from("payment_proofs")
    .update({
      status,
      reviewer_id: reviewerId ? String(reviewerId) : null,
      reviewed_at: isoNow(),
      note: note || null,
    })
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) {
    console.error("setProofStatus error:", error.message);
    return null;
  }
  return data || null;
}

module.exports = { createProof, getProofById, setProofStatus };
