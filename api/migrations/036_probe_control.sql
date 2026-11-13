-- What else reached each node, to compare its AWG port with (node/host/vessel-probe-watch.sh, toomore/anoni-net-ws#487):
-- new TCP connections to the port's number, where nothing listens, and packets to a UDP port with no service. Each
-- has its packets, how many addresses sent them, and how many of those are registered in China. Counts only. NULL for
-- hours before the node had them, and the control port's for a node without one.
ALTER TABLE probe_hours
    ADD COLUMN tcp_packets     bigint,
    ADD COLUMN tcp_sources     bigint,
    ADD COLUMN tcp_china       bigint,
    ADD COLUMN control_packets bigint,
    ADD COLUMN control_sources bigint,
    ADD COLUMN control_china   bigint;
