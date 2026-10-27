from app import crypto


def test_account_number_format():
    number = crypto.new_account_number()
    assert len(number) == 16 and number.isdigit()
    formatted = crypto.format_account_number(number)
    assert len(formatted) == 19 and formatted.count(" ") == 3
    assert crypto.normalize_account_number(formatted) == number
    assert crypto.normalize_account_number(formatted.replace(" ", "-")) == number


def test_account_number_rejects_bad_input():
    for raw in ["", "123", "1234 5678 9012 345", "1234 5678 9012 34567", "abcd efgh ijkl mnop", "１２３４５６７８９０１２３４５６"]:
        assert crypto.normalize_account_number(raw) is None


def test_hash_is_deterministic_and_peppered():
    a = crypto.hash_account_number("1234567890123456", "pepper-a")
    assert a == crypto.hash_account_number("1234567890123456", "pepper-a")
    assert a != crypto.hash_account_number("1234567890123456", "pepper-b")
    assert a != crypto.hash_account_number("1234567890123457", "pepper-a")
    assert b"1234567890123456" not in a


def test_invite_code_normalization():
    code = crypto.new_invite_code()
    assert len(code) == 19
    normalized = crypto.normalize_invite_code(code)
    assert normalized == code.replace("-", "")
    assert crypto.normalize_invite_code(code.lower()) == normalized
    assert crypto.normalize_invite_code("abcd efgh jkmn pqrs") == "ABCDEFGHJKMNPQRS"
    # I, L and O read as 1, 1 and 0
    assert crypto.normalize_invite_code("ILO0-0000-0000-0000") == "1100000000000000"
    assert crypto.normalize_invite_code("ABCD-EFGH-JKMN-PQRU") is None
    assert crypto.normalize_invite_code("short") is None
