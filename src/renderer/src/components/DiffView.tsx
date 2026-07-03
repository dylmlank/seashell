import ReactDiffViewer from 'react-diff-viewer-continued'

export function DiffView({
  oldValue,
  newValue
}: {
  oldValue: string
  newValue: string
}): React.JSX.Element {
  return (
    <div className="max-h-96 overflow-auto rounded-lg border border-border text-xs">
      <ReactDiffViewer
        oldValue={oldValue}
        newValue={newValue}
        splitView={false}
        useDarkTheme
        hideLineNumbers={false}
        styles={{
          variables: {
            dark: {
              diffViewerBackground: '#1a1a1a',
              gutterBackground: '#232323',
              addedBackground: '#12351f',
              addedGutterBackground: '#164a28',
              removedBackground: '#3d1a1a',
              removedGutterBackground: '#521f1f',
              wordAddedBackground: '#1c5a32',
              wordRemovedBackground: '#7a2e2e'
            }
          }
        }}
      />
    </div>
  )
}
