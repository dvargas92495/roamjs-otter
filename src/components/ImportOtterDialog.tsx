import {
  Button,
  Classes,
  Dialog,
  Intent,
  Radio,
  RadioGroup,
  Spinner,
  SpinnerSize,
} from "@blueprintjs/core";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import createBlock from "roamjs-components/writes/createBlock";
import deleteBlock from "roamjs-components/writes/deleteBlock";
import getBasicTreeByParentUid from "roamjs-components/queries/getBasicTreeByParentUid";
import getOrderByBlockUid from "roamjs-components/queries/getOrderByBlockUid";
import getParentUidByBlockUid from "roamjs-components/queries/getParentUidByBlockUid";
import createOverlayRender from "roamjs-components/util/createOverlayRender";
import getSettingValueFromTree from "roamjs-components/util/getSettingValueFromTree";
import getSubTree from "roamjs-components/util/getSubTree";
import setInputSetting from "roamjs-components/util/setInputSetting";
import toRoamDate from "roamjs-components/date/toRoamDate";
import format from "date-fns/format";
import addDays from "date-fns/addDays"
import localStorageGet from 'roamjs-components/util/localStorageGet';
import apiPost from 'roamjs-components/util/apiPost';
import type { InputTextNode } from "roamjs-components/types";

type DialogProps = {
  blockUid: string;
  pageUid: string;
};

const offsetToTimestamp = (offset?: number) => {
  if (!offset) {
    return "00:00";
  }
  const totalSeconds = Math.round(offset / 16000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}:${`${seconds}`.padStart(2, "0")}`;
};

const replaceDateSubstitutions = (text: string) =>
    text.replace(/{today}/gi, `[[${toRoamDate(new Date())}]]`)
    .replace(/{tomorrow}/gi, `[[${toRoamDate(addDays(new Date(), 1))}]]`)


export const DEFAULT_LABEL = `{title} - {summary} ({created-date})`;
export const DEFAULT_TEMPLATE = `{start} - {end} - {text}`;
export const importSpeech = ({
  credentials,
  id,
  order,
  parentUid,
  label,
  template,
  onSuccess,
  configUid,
}: {
  credentials: { email: string; password: string };
  id: string;
  order: number;
  parentUid: string;
  label: string;
  template: string;
  onSuccess?: (id: string) => void;
  configUid: string;
}): Promise<InputTextNode[]> =>
  apiPost(`otter`, {
      ...credentials,
      operation: "GET_SPEECH",
      params: { id },
    })
    .then((r) => {
      const data = r.data as {
        title: string;
        summary: string;
        createdDate: number;
        link: string;
        transcripts: {
          start: number;
          end: number;
          text: string;
          speaker: string;
        }[];
      };
      const newBlockUid = window.roamAlphaAPI.util.generateUID();
      let labelWithReplacements = label
          .replace(/{title}/gi, data.title || "Untitled")
          .replace(/{summary}/gi, data.summary)
          .replace(/{created-date(?::(.*?))?}/gi, (_, i) =>
              i
                  ? format(new Date(data.createdDate * 1000), i)
                  : new Date(data.createdDate * 1000).toLocaleString()
          )
          .replace(/{link}/gi, data.link)

      const node = {
        uid: newBlockUid,
        text: replaceDateSubstitutions(labelWithReplacements),
        children: [
          ...data.transcripts.slice(0, 295).map((t) => {
            return ({
              text: replaceDateSubstitutions(template
                .replace(/{start}/gi, offsetToTimestamp(t.start))
                .replace(/{end}/gi, offsetToTimestamp(t.end))
                .replace(/{text}/gi, t.text)
                .replace(/{speaker(:initials)?}/gi, (_, i) =>
                    i
                        ? t.speaker
                            .split(" ")
                            .map((s) => `${s.slice(0, 1).toUpperCase()}.`)
                            .join("")
                        : t.speaker
                )),
            })
          }),
          ...(data.transcripts.length > 295
            ? [
                {
                  text: "Roam currently only allows 300 blocks to be created at once. If you need larger transcripts to be imported, please reach out to support@roamjs.com!",
                },
              ]
            : []),
        ],
      };
      const { uid: idsUid } = getSubTree({ key: "ids", parentUid: configUid });

      if (onSuccess) {
        return createBlock({
          parentUid,
          node,
          order,
        })
          .then(() =>
            setInputSetting({ blockUid: idsUid, key: id, value: newBlockUid })
          )
          .then(() => onSuccess(id))
          .then(() => []);
      } else {
        return setInputSetting({
          blockUid: idsUid,
          key: id,
          value: newBlockUid,
        }).then(() => [node]);
      }
    });

const ImportOtterDialog = ({
  onClose,
  blockUid,
  pageUid,
}: {
  onClose: () => void;
} & DialogProps) => {
  const { otterCredentials, label, template } = useMemo(() => {
    const tree = getBasicTreeByParentUid(pageUid);
    const email = getSettingValueFromTree({ tree, key: "email" });
    const password = localStorageGet('otter-password');
    const label = getSettingValueFromTree({
      tree,
      key: "label",
      defaultValue: DEFAULT_LABEL,
    });
    const template = getSettingValueFromTree({
      tree,
      key: "template",
      defaultValue: DEFAULT_TEMPLATE,
    });
    return { otterCredentials: { email, password }, label, template };
  }, []);
  const [speeches, setSpeeches] = useState([]);
  const [value, setValue] = useState("");
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [lastLoad, setLastLoad] = useState(0);
  const [lastModified, setLastModified] = useState(0);
  const [isEnd, setIsEnd] = useState(false);
  useEffect(() => {
    if (initialLoading) {
      setError("");
      apiPost(`otter`, {
          ...otterCredentials,
          operation: "GET_SPEECHES",
          params: { lastLoad, lastModified },
        })
        .then((r) => {
          setInitialLoading(false);
          if (!isEnd) {
            setSpeeches([...speeches, ...r.data.speeches]);
            setLastLoad(r.data.lastLoad);
            setLastModified(r.data.lastModified);
            setIsEnd(r.data.isEnd);
          }
        })
        .catch((e) => {
          setError(e.response?.data || e.message);
          setInitialLoading(false);
        });
    }
  }, [
    setSpeeches,
    lastLoad,
    lastModified,
    speeches,
    isEnd,
    setLastModified,
    setLastLoad,
    setIsEnd,
    setInitialLoading,
    initialLoading,
    setError,
  ]);
  const onDeleteClose = useCallback(() => {
    onClose();
    deleteBlock(blockUid);
  }, [blockUid, onClose]);
  return (
    <Dialog
      isOpen={true}
      canEscapeKeyClose
      canOutsideClickClose
      title={"Import Otter Speech"}
      onClose={onDeleteClose}
    >
      <div className={Classes.DIALOG_BODY}>
        <RadioGroup
          selectedValue={value}
          onChange={(e) => setValue((e.target as HTMLInputElement).value)}
        >
          {speeches.slice(page, page + 10).map((s) => (
            <Radio
              value={s.id}
              key={s.id}
              labelElement={
                <span>
                  <b>{s.title || "Untitled"}</b> -{" "}
                  <span style={{ fontWeight: 400 }}>{s.summary}</span>{" "}
                  <span style={{ fontSize: 8, fontWeight: 400 }}>
                    ({new Date(s.createdDate * 1000).toLocaleString()})
                  </span>
                </span>
              }
            />
          ))}
        </RadioGroup>
        <div
          style={{
            marginTop: 16,
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <Button
            text={"Previous"}
            disabled={page === 0}
            onClick={() => setPage(page - 10)}
          />
          <Button
            text={"Next"}
            disabled={isEnd && page + 10 >= speeches.length}
            onClick={() => {
              setPage(page + 10);
              if (!isEnd && page + 10 >= speeches.length) {
                setInitialLoading(true);
              }
            }}
          />
        </div>
      </div>
      <div className={Classes.DIALOG_FOOTER}>
        <div className={Classes.DIALOG_FOOTER_ACTIONS}>
          {(loading || initialLoading) && <Spinner size={SpinnerSize.SMALL} />}
          <span style={{ color: "darkred" }}>{error}</span>
          <Button
            disabled={loading || !value}
            text={"Import"}
            intent={Intent.PRIMARY}
            onClick={() => {
              setLoading(true);
              importSpeech({
                credentials: otterCredentials,
                id: value,
                parentUid: getParentUidByBlockUid(blockUid),
                label,
                template,
                onSuccess: onDeleteClose,
                configUid: pageUid,
                order: getOrderByBlockUid(blockUid),
              });
            }}
          />
        </div>
      </div>
    </Dialog>
  );
};

export const render = createOverlayRender<DialogProps>(
  "otter-import",
  ImportOtterDialog
);

export default ImportOtterDialog;
