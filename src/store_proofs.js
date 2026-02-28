const { supabase } = require("./supabase");

async function createProof(payload) {
  const { data, error } = await supabase
    .from("payment_proofs")
    .insert(payload)
    .select("id")
    .single();

  return {
    id: data?.id || null,
    error: error?.message || null,
  };
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
      reviewed_at: new Date().toISOString(),
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
