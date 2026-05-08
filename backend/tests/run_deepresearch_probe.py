from services.doc_qa_service import doc_qa_service


def main() -> None:
    try:
        result = doc_qa_service.deep_research("小麦赤霉病防治要点", top_k=8, max_sub_questions=4)
        print("ok", list(result.keys()))
    except Exception as exc:  # noqa: BLE001
        import traceback

        traceback.print_exc()
        print("error", str(exc))


if __name__ == "__main__":
    main()
